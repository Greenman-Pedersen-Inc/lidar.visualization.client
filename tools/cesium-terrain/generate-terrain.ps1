[CmdletBinding()]
param(
    [string]$Config,
    [string]$InputDir,
    [string]$WorkDir,
    [string]$ResumeRun,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$script:NativeToolDirectories = @()
$script:NativeGdalData = $null
$script:NativeProjData = $null

function Show-Usage {
    @'
Generate Cesium quantized-mesh terrain from local COPC files on Windows.

Usage:
  .\generate-terrain.ps1 -Config C:\lidar\terrain.config.psd1
  .\generate-terrain.ps1 -InputDir D:\lidar\copc -WorkDir D:\lidar\terrain-work
  .\generate-terrain.ps1 -Config C:\lidar\terrain.config.psd1 -ResumeRun C:\lidar\terrain-work\20260923T200149Z-12345

Requirements:
  pdal, GDAL, Java 21+, and the Mago 3DTerrainer JAR must be installed locally.
  Both the modern unified GDAL CLI and legacy GDAL scripts are supported. The
  PDAL Conda environment is found automatically; activation is not required.

This script never uploads or deletes remote objects.
'@ | Write-Host
}

if ($Help) {
    Show-Usage
    exit 0
}

function Write-Step {
    param([string]$Message)
    $timestamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    Write-Host "`n[$timestamp] $Message" -ForegroundColor Cyan
}

function Get-Setting {
    param([hashtable]$Settings, [string]$Name, $Default)
    if ($Settings.ContainsKey($Name) -and $null -ne $Settings[$Name]) {
        return $Settings[$Name]
    }
    return $Default
}

function Find-Tool {
    param(
        [string]$ConfiguredValue,
        [string[]]$FallbackNames
    )

    $candidates = @()
    if ($ConfiguredValue) { $candidates += $ConfiguredValue }
    $candidates += $FallbackNames
    $candidates = @($candidates | Select-Object -Unique)

    foreach ($candidate in $candidates) {
        if ([IO.Path]::IsPathRooted($candidate) -or $candidate.Contains([IO.Path]::DirectorySeparatorChar)) {
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                return (Resolve-Path -LiteralPath $candidate).Path
            }
            continue
        }

        $command = Get-Command $candidate -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            return $command.Source
        }
    }

    return $null
}

function Resolve-Tool {
    param(
        [string]$ConfiguredValue,
        [string[]]$FallbackNames,
        [string]$DisplayName
    )

    $resolvedTool = Find-Tool $ConfiguredValue $FallbackNames
    if ($resolvedTool) { return $resolvedTool }

    $candidates = @()
    if ($ConfiguredValue) { $candidates += $ConfiguredValue }
    $candidates += $FallbackNames
    $candidates = @($candidates | Select-Object -Unique)
    throw "$DisplayName was not found. Tried: $($candidates -join ', '). Install it or set its command path in the configuration file."
}

function Get-CondaEnvironmentFromTool {
    param([string]$ToolPath)

    if (-not $ToolPath -or -not [IO.Path]::IsPathRooted($ToolPath)) { return $null }
    $currentPath = Split-Path -Parent $ToolPath
    for ($level = 0; $level -lt 5 -and $currentPath; $level++) {
        if (Test-Path -LiteralPath (Join-Path $currentPath 'conda-meta') -PathType Container) {
            return $currentPath
        }
        $parentPath = Split-Path -Parent $currentPath
        if ($parentPath -eq $currentPath) { break }
        $currentPath = $parentPath
    }
    return $null
}

function Test-PdalCondaEnvironment {
    param([string]$EnvironmentPath)
    if (-not $EnvironmentPath -or -not (Test-Path -LiteralPath $EnvironmentPath -PathType Container)) { return $false }
    return (
        (Test-Path -LiteralPath (Join-Path $EnvironmentPath 'Library\bin\pdal.exe') -PathType Leaf) -or
        (Test-Path -LiteralPath (Join-Path $EnvironmentPath 'pdal.exe') -PathType Leaf)
    )
}

function Get-JavaFallbacks {
    $candidates = New-Object Collections.Generic.List[string]
    if ($env:JAVA_HOME) { $candidates.Add((Join-Path $env:JAVA_HOME 'bin\java.exe')) }

    $programFiles = [Environment]::GetFolderPath('ProgramFiles')
    if (-not [string]::IsNullOrWhiteSpace($programFiles)) {
        foreach ($vendorDirectory in @('Eclipse Adoptium', 'Microsoft', 'Java', 'Amazon Corretto', 'Zulu')) {
            $vendorPath = Join-Path $programFiles $vendorDirectory
            if (-not (Test-Path -LiteralPath $vendorPath -PathType Container)) { continue }
            Get-ChildItem -LiteralPath $vendorPath -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match '(?i)(jdk|java).*21|21.*(jdk|java)' } |
                Sort-Object Name -Descending |
                ForEach-Object { $candidates.Add((Join-Path $_.FullName 'bin\java.exe')) }
        }
    }

    $candidates.Add('java.exe')
    $candidates.Add('java')
    return @($candidates | Select-Object -Unique)
}

function Find-CondaEnvironment {
    param(
        [string]$ConfiguredEnvironment,
        [string]$ConfiguredPdalCommand
    )

    if ($ConfiguredEnvironment) {
        if (-not [IO.Path]::IsPathRooted($ConfiguredEnvironment)) {
            throw 'CondaEnvironmentDir must be an absolute path.'
        }
        if (-not (Test-Path -LiteralPath $ConfiguredEnvironment -PathType Container)) {
            throw "Conda environment directory does not exist: $ConfiguredEnvironment"
        }
        return (Resolve-Path -LiteralPath $ConfiguredEnvironment).Path
    }

    $candidatePaths = New-Object Collections.Generic.List[string]
    if ($ConfiguredPdalCommand -and [IO.Path]::IsPathRooted($ConfiguredPdalCommand)) {
        $derivedPath = Get-CondaEnvironmentFromTool $ConfiguredPdalCommand
        if ($derivedPath) { $candidatePaths.Add($derivedPath) }
    }

    $pdalOnPath = Get-Command 'pdal.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pdalOnPath) {
        $derivedPath = Get-CondaEnvironmentFromTool $pdalOnPath.Source
        if ($derivedPath) { $candidatePaths.Add($derivedPath) }
    }

    if ($env:CONDA_PREFIX) { $candidatePaths.Add($env:CONDA_PREFIX) }

    $commonCondaRoots = New-Object Collections.Generic.List[string]
    $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
    $userProfile = [Environment]::GetFolderPath('UserProfile')
    $programData = [Environment]::GetFolderPath('CommonApplicationData')
    foreach ($parentPath in @($localAppData, $userProfile, $programData)) {
        if ([string]::IsNullOrWhiteSpace($parentPath)) { continue }
        foreach ($folderName in @('miniforge3', 'Miniforge3', 'miniconda3', 'Miniconda3', 'anaconda3', 'Anaconda3')) {
            $commonCondaRoots.Add((Join-Path $parentPath $folderName))
        }
    }
    foreach ($rootPath in $commonCondaRoots) {
        $candidatePaths.Add((Join-Path $rootPath 'envs\pdal'))
        $candidatePaths.Add($rootPath)
        $environmentParent = Join-Path $rootPath 'envs'
        if (Test-Path -LiteralPath $environmentParent -PathType Container) {
            Get-ChildItem -LiteralPath $environmentParent -Directory -ErrorAction SilentlyContinue |
                ForEach-Object { $candidatePaths.Add($_.FullName) }
        }
    }

    $userEnvironmentParent = Join-Path $userProfile '.conda\envs'
    if (Test-Path -LiteralPath $userEnvironmentParent -PathType Container) {
        Get-ChildItem -LiteralPath $userEnvironmentParent -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { $candidatePaths.Add($_.FullName) }
    }

    # Match convert_package_las_to_copc.ps1: ask Conda for every environment
    # when conda is callable, then test each returned environment for PDAL.
    $condaCommand = Get-Command conda -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($condaCommand) {
        try {
            $oldPreference = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $environmentJson = @(& $condaCommand.Source env list --json 2>$null) -join [Environment]::NewLine
            $environmentList = $environmentJson | ConvertFrom-Json
            foreach ($environmentPath in @($environmentList.envs)) {
                $candidatePaths.Add([string]$environmentPath)
            }
        }
        catch {
            # Common-location discovery below still works when Conda cannot run.
        }
        finally {
            $ErrorActionPreference = $oldPreference
        }
    }

    foreach ($candidatePath in @($candidatePaths | Select-Object -Unique)) {
        if (Test-PdalCondaEnvironment $candidatePath) {
            return (Resolve-Path -LiteralPath $candidatePath).Path
        }
    }

    return $null
}

function Invoke-NativeTool {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$Capture
    )

    $oldPath = $env:PATH
    $oldProjLib = $env:PROJ_LIB
    $oldProjData = $env:PROJ_DATA
    $oldGdalData = $env:GDAL_DATA
    $oldPreference = $ErrorActionPreference
    try {
        if ($script:NativeToolDirectories.Count -gt 0) {
            $env:PATH = (($script:NativeToolDirectories + @($oldPath)) -join [IO.Path]::PathSeparator)
        }
        if ($script:NativeProjData) {
            $env:PROJ_LIB = $script:NativeProjData
            $env:PROJ_DATA = $script:NativeProjData
        }
        if ($script:NativeGdalData) { $env:GDAL_DATA = $script:NativeGdalData }
        $ErrorActionPreference = 'Continue'

        if ($Capture) {
            $output = @(& $Command @Arguments 2>&1)
            $exitCode = $LASTEXITCODE
            if ($exitCode -ne 0) {
                $output | ForEach-Object { Write-Host $_ }
                throw "$Command exited with code $exitCode."
            }
            return $output
        }

        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Command exited with code $LASTEXITCODE."
        }
    }
    finally {
        $env:PATH = $oldPath
        $env:PROJ_LIB = $oldProjLib
        $env:PROJ_DATA = $oldProjData
        $env:GDAL_DATA = $oldGdalData
        $ErrorActionPreference = $oldPreference
    }
}

$settings = @{}
if ($Config) {
    $configPath = (Resolve-Path -LiteralPath $Config).Path
    $loadedSettings = Import-PowerShellDataFile -LiteralPath $configPath
    foreach ($key in $loadedSettings.Keys) {
        $settings[$key] = $loadedSettings[$key]
    }
}

$configuredPdalCommand = [string](Get-Setting $settings 'PdalCommand' '')
$condaEnvironmentDir = Find-CondaEnvironment ([string](Get-Setting $settings 'CondaEnvironmentDir' '')) $configuredPdalCommand
$condaToolDirectories = @()
$condaScripts = $null
if ($condaEnvironmentDir) {
    Write-Host "Conda environment: $condaEnvironmentDir"
    $condaLibraryBin = Join-Path $condaEnvironmentDir 'Library\bin'
    $condaScripts = Join-Path $condaEnvironmentDir 'Scripts'
    $condaToolDirectories = @($condaLibraryBin, $condaScripts, $condaEnvironmentDir)

    $existingToolDirectories = @($condaToolDirectories | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
    $script:NativeToolDirectories = $existingToolDirectories

    $gdalDataPath = [string](Get-Setting $settings 'GdalDataDir' (Join-Path $condaEnvironmentDir 'Library\share\gdal'))
    $projDataPath = [string](Get-Setting $settings 'ProjDataDir' (Join-Path $condaEnvironmentDir 'Library\share\proj'))
    if (Test-Path -LiteralPath $gdalDataPath -PathType Container) {
        $script:NativeGdalData = (Resolve-Path -LiteralPath $gdalDataPath).Path
    }
    if (Test-Path -LiteralPath $projDataPath -PathType Container) {
        $script:NativeProjData = (Resolve-Path -LiteralPath $projDataPath).Path
    }
}

if (-not $InputDir) { $InputDir = [string](Get-Setting $settings 'InputDir' '') }
if (-not $WorkDir) { $WorkDir = [string](Get-Setting $settings 'WorkDir' '') }
if (-not $InputDir) { throw 'InputDir is required.' }
if (-not (Test-Path -LiteralPath $InputDir -PathType Container)) {
    throw "COPC input directory does not exist: $InputDir"
}
if (-not $WorkDir) { throw 'WorkDir is required.' }

$inputPath = (Resolve-Path -LiteralPath $InputDir).Path
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
$workPath = (Resolve-Path -LiteralPath $WorkDir).Path
$copcFiles = @(Get-ChildItem -LiteralPath $inputPath -Filter '*.copc.laz' -File)
if ($copcFiles.Count -eq 0) { throw "No *.copc.laz files were found in $inputPath" }

Write-Step 'Locating native processing tools'
$pdalFallbacks = @($condaToolDirectories | ForEach-Object { Join-Path $_ 'pdal.exe' }) + @('pdal.exe', 'pdal')
$gdalWarpFallbacks = @($condaToolDirectories | ForEach-Object { Join-Path $_ 'gdalwarp.exe' }) + @('gdalwarp.exe', 'gdalwarp')
$gdalInfoFallbacks = @($condaToolDirectories | ForEach-Object { Join-Path $_ 'gdalinfo.exe' }) + @('gdalinfo.exe', 'gdalinfo')
$gdalFallbacks = @($condaToolDirectories | ForEach-Object { Join-Path $_ 'gdal.exe' }) + @('gdal.exe', 'gdal')
$gdalFillFallbacks = @($condaToolDirectories | ForEach-Object { Join-Path $_ 'gdal_fillnodata.exe' }) + @(
    $condaScripts | ForEach-Object { Join-Path $_ 'gdal_fillnodata.py' }
) + @('gdal_fillnodata.exe', 'gdal_fillnodata', 'gdal_fillnodata.py')
$gdalEditFallbacks = @($condaToolDirectories | ForEach-Object { Join-Path $_ 'gdal_edit.exe' }) + @(
    $condaScripts | ForEach-Object { Join-Path $_ 'gdal_edit.py' }
) + @('gdal_edit.exe', 'gdal_edit', 'gdal_edit.py')

$pdalCommand = Resolve-Tool $configuredPdalCommand $pdalFallbacks 'PDAL'
$gdalWarpCommand = Resolve-Tool ([string](Get-Setting $settings 'GdalWarpCommand' '')) $gdalWarpFallbacks 'gdalwarp'
$gdalInfoCommand = Resolve-Tool ([string](Get-Setting $settings 'GdalInfoCommand' '')) $gdalInfoFallbacks 'gdalinfo'
$gdalCommand = Find-Tool ([string](Get-Setting $settings 'GdalCommand' '')) $gdalFallbacks
$gdalFillNoDataCommand = Find-Tool ([string](Get-Setting $settings 'GdalFillNoDataCommand' '')) $gdalFillFallbacks
$gdalEditCommand = Find-Tool ([string](Get-Setting $settings 'GdalEditCommand' '')) $gdalEditFallbacks
$useUnifiedGdalFill = -not [bool]$gdalFillNoDataCommand
$useUnifiedGdalEdit = -not [bool]$gdalEditCommand
if (($useUnifiedGdalFill -or $useUnifiedGdalEdit) -and -not $gdalCommand) {
    throw 'Neither the legacy GDAL scripts nor the unified gdal.exe command was found.'
}
$javaCommand = Resolve-Tool ([string](Get-Setting $settings 'JavaCommand' '')) (Get-JavaFallbacks) 'Java 21 or newer'
$magoTerrainJar = [string](Get-Setting $settings 'MagoTerrainJar' '')
if (-not $magoTerrainJar) {
    throw 'MagoTerrainJar is required. Download the Mago 3DTerrainer release JAR and set its absolute path in the configuration file.'
}
if (-not [IO.Path]::IsPathRooted($magoTerrainJar)) {
    throw 'MagoTerrainJar must be an absolute path.'
}
if (-not (Test-Path -LiteralPath $magoTerrainJar -PathType Leaf)) {
    throw "Mago 3DTerrainer JAR was not found: $magoTerrainJar"
}
$magoTerrainJar = (Resolve-Path -LiteralPath $magoTerrainJar).Path
$magoMaxHeapGb = [int](Get-Setting $settings 'MagoMaxHeapGb' 12)
$magoIntensity = [double](Get-Setting $settings 'MagoIntensity' 4.0)
$magoRasterMaxSize = [int](Get-Setting $settings 'MagoRasterMaxSize' 4096)
$magoMosaicSize = [int](Get-Setting $settings 'MagoMosaicSize' 8)
$magoMaxDepth = [string](Get-Setting $settings 'MagoMaxDepth' '')
if ($magoMaxHeapGb -lt 1 -or $magoRasterMaxSize -lt 256 -or $magoMosaicSize -lt 1) {
    throw 'MagoMaxHeapGb, MagoRasterMaxSize, and MagoMosaicSize must be positive.'
}
if ($magoIntensity -lt 1 -or $magoIntensity -gt 16) {
    throw 'MagoIntensity must be between 1 and 16.'
}
if ($magoMaxDepth) {
    if ($magoMaxDepth -notmatch '^[0-9]+$') {
        throw 'MagoMaxDepth must be empty for automatic selection or an integer from 0 through 22.'
    }
    $magoMaxDepthValue = [int]$magoMaxDepth
    if ($magoMaxDepthValue -lt 0 -or $magoMaxDepthValue -gt 22) {
        throw 'MagoMaxDepth must be empty for automatic selection or an integer from 0 through 22.'
    }
    $magoMaxDepth = [string]$magoMaxDepthValue
}

Write-Host "PDAL:             $pdalCommand"
Write-Host "gdalwarp:         $gdalWarpCommand"
Write-Host "gdalinfo:         $gdalInfoCommand"
Write-Host "fill nodata:      $(if ($useUnifiedGdalFill) { "$gdalCommand raster fill-nodata" } else { $gdalFillNoDataCommand })"
Write-Host "edit raster:      $(if ($useUnifiedGdalEdit) { "$gdalCommand raster edit" } else { $gdalEditCommand })"
Write-Host "Java:             $javaCommand"
Write-Host "Mago JAR:         $magoTerrainJar"

$javaVersionLines = Invoke-NativeTool $javaCommand @('-version') -Capture
$javaVersionText = $javaVersionLines -join [Environment]::NewLine
$javaVersionMatch = [regex]::Match($javaVersionText, '(?im)(?:openjdk|java) version "(?<major>[0-9]+)')
if ($javaVersionMatch.Success -and [int]$javaVersionMatch.Groups['major'].Value -lt 21) {
    throw "Mago 3DTerrainer requires Java 21 or newer. Found:`n$javaVersionText"
}

function Invoke-FillNoData {
    param([string]$InputPath, [string]$OutputPath, [int]$Distance, [int]$SmoothIterations)
    if ($useUnifiedGdalFill) {
        Invoke-NativeTool $gdalCommand @(
            'raster', 'fill-nodata',
            '--max-distance', [string]$Distance,
            '--smoothing-iterations', [string]$SmoothIterations,
            $InputPath, $OutputPath
        )
    } else {
        Invoke-NativeTool $gdalFillNoDataCommand @(
            '-md', [string]$Distance,
            '-si', [string]$SmoothIterations,
            $InputPath, $OutputPath
        )
    }
}

function Set-RasterCrs {
    param([string]$RasterPath, [string]$Crs)
    if ($useUnifiedGdalEdit) {
        Invoke-NativeTool $gdalCommand @('raster', 'edit', '--crs', $Crs, $RasterPath)
    } else {
        Invoke-NativeTool $gdalEditCommand @('-a_srs', $Crs, $RasterPath)
    }
}

if ($ResumeRun) {
    if (-not [IO.Path]::IsPathRooted($ResumeRun)) {
        throw 'ResumeRun must be an absolute path.'
    }
    if (-not (Test-Path -LiteralPath $ResumeRun -PathType Container)) {
        throw "Resume run directory does not exist: $ResumeRun"
    }
    $runPath = (Resolve-Path -LiteralPath $ResumeRun).Path
    $runId = Split-Path -Leaf $runPath
} else {
    $runId = [string](Get-Setting $settings 'RunId' '')
    if (-not $runId) { $runId = '{0}-{1}' -f [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'), $PID }
    if ($runId -notmatch '^[A-Za-z0-9._-]+$') {
        throw 'RunId may contain only letters, numbers, periods, underscores, and dashes.'
    }

    $runPath = Join-Path $workPath $runId
    if (Test-Path -LiteralPath $runPath) { throw "Run directory already exists: $runPath" }
}
$terrainPath = Join-Path $runPath 'terrain'
New-Item -ItemType Directory -Path $terrainPath -Force | Out-Null

$sourceHorizontalCrs = [string](Get-Setting $settings 'SourceHorizontalCrs' 'EPSG:3424')
$sourceCompoundCrs = [string](Get-Setting $settings 'SourceCompoundCrs' 'EPSG:3424+5703')
$target3dCrs = [string](Get-Setting $settings 'Target3dCrs' 'EPSG:4979')
$applyVerticalTransform = [bool](Get-Setting $settings 'ApplyVerticalTransform' $true)
$zScale = [double](Get-Setting $settings 'ZScale' 0.3048006096012192)

$rawGroundClasses = Get-Setting $settings 'GroundClasses' @(2)
if ($rawGroundClasses -is [string]) {
    $groundClasses = @($rawGroundClasses.Split(',') | ForEach-Object { [int]$_.Trim() })
} else {
    $groundClasses = @($rawGroundClasses | ForEach-Object { [int]$_ })
}
if ($groundClasses.Count -eq 0) { throw 'GroundClasses must contain at least one ASPRS classification number.' }
$groundExpression = (($groundClasses | ForEach-Object { "Classification == $_" }) -join ' || ')

$classifyGround = [bool](Get-Setting $settings 'ClassifyGround' $false)
$smrfCell = [double](Get-Setting $settings 'SmrfCell' 3.280833333)
$smrfWindow = [double](Get-Setting $settings 'SmrfWindow' 59.055)
$smrfThreshold = [double](Get-Setting $settings 'SmrfThreshold' 1.640416667)
$smrfSlope = [double](Get-Setting $settings 'SmrfSlope' 0.15)
$smrfReturns = [string](Get-Setting $settings 'SmrfReturns' 'last,only')
$denoiseGroundCandidates = [bool](Get-Setting $settings 'DenoiseGroundCandidates' $false)
$outlierMeanK = [int](Get-Setting $settings 'OutlierMeanK' 12)
$outlierMultiplier = [double](Get-Setting $settings 'OutlierMultiplier' 2.2)

$demResolution = [double](Get-Setting $settings 'DemResolution' 1.0)
$demRadius = [double](Get-Setting $settings 'DemRadius' 1.5)
$demWindowSize = [int](Get-Setting $settings 'DemWindowSize' 5)
$fillDistance = [int](Get-Setting $settings 'FillDistance' 500)
$fillSmoothIterations = [int](Get-Setting $settings 'FillSmoothIterations' 2)
$minimumValidPercent = [double](Get-Setting $settings 'MinimumValidPercent' 1.0)
$backgroundDem = [string](Get-Setting $settings 'BackgroundDem' '')
$destinationS3Uri = [string](Get-Setting $settings 'DestinationS3Uri' 's3://njdot-lidar-streaming-test/Baker-2021-Route9-North-middle10-20260917-101430/terrain/')
$publicTerrainUrl = [string](Get-Setting $settings 'PublicTerrainUrl' 'https://njdot-lidar-streaming-test.s3.us-east-1.amazonaws.com/Baker-2021-Route9-North-middle10-20260917-101430/terrain/')

foreach ($crs in @($sourceHorizontalCrs, $sourceCompoundCrs, $target3dCrs)) {
    if ($crs -notmatch '^[A-Za-z0-9:._+-]+$') { throw "CRS contains unsupported characters: $crs" }
}
if ($demResolution -le 0 -or $demRadius -le 0 -or $demWindowSize -lt 0 -or $fillDistance -lt 0) {
    throw 'DEM resolution and radius must be positive; window size and fill distance may not be negative.'
}
if ($outlierMeanK -lt 2 -or $outlierMultiplier -le 0) {
    throw 'OutlierMeanK must be at least 2 and OutlierMultiplier must be positive.'
}
if ($minimumValidPercent -le 0 -or $minimumValidPercent -gt 100) {
    throw 'MinimumValidPercent must be greater than 0 and no greater than 100.'
}
if ($backgroundDem) {
    if (-not [IO.Path]::IsPathRooted($backgroundDem)) {
        throw 'BackgroundDem must be an absolute path.'
    }
    if (-not (Test-Path -LiteralPath $backgroundDem -PathType Leaf)) {
        throw "Background DEM was not found: $backgroundDem"
    }
    $backgroundDem = (Resolve-Path -LiteralPath $backgroundDem).Path
}

$copcPattern = (Join-Path $inputPath '*.copc.laz').Replace('\', '/')
$dtmSourcePath = Join-Path $runPath 'dtm-source.tif'
$dtmSourceFilledPath = Join-Path $runPath 'dtm-source-filled.tif'
$dtmWgs84Path = Join-Path $runPath 'dtm-wgs84.tif'
$dtmReadyPath = Join-Path $runPath 'dtm-ready.tif'

$pipeline = @()
$pipeline += [ordered]@{
    type = 'readers.copc'
    filename = $copcPattern
    default_srs = $sourceHorizontalCrs
}
if ($classifyGround) {
    $pipeline += [ordered]@{
        type = 'filters.smrf'
        cell = $smrfCell
        window = $smrfWindow
        threshold = $smrfThreshold
        slope = $smrfSlope
        returns = $smrfReturns
    }
}
$pipeline += [ordered]@{ type = 'filters.expression'; expression = $groundExpression }
if ($denoiseGroundCandidates) {
    $pipeline += [ordered]@{
        type = 'filters.outlier'
        method = 'statistical'
        mean_k = $outlierMeanK
        multiplier = $outlierMultiplier
    }
    $pipeline += [ordered]@{ type = 'filters.expression'; expression = 'Classification != 7' }
}
$pipeline += [ordered]@{
    type = 'filters.assign'
    value = "Z = Z * $($zScale.ToString([Globalization.CultureInfo]::InvariantCulture))"
}
$pipeline += [ordered]@{
    type = 'writers.gdal'
    filename = $dtmSourcePath.Replace('\', '/')
    resolution = $demResolution
    radius = $demRadius
    output_type = 'idw'
    window_size = $demWindowSize
    data_type = 'float'
    nodata = -9999
    gdalopts = 'TILED=YES,COMPRESS=DEFLATE'
}

$pipelinePath = Join-Path $runPath 'copc-to-dem.json'
$pipelineJson = ([ordered]@{ pipeline = $pipeline }) | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText($pipelinePath, $pipelineJson, (New-Object Text.UTF8Encoding($false)))

$previousProjNetwork = $env:PROJ_NETWORK
$env:PROJ_NETWORK = 'ON'
try {
    if ($ResumeRun) {
        if (-not (Test-Path -LiteralPath $dtmWgs84Path -PathType Leaf)) {
            throw "ResumeRun does not contain dtm-wgs84.tif: $runPath"
        }
        Write-Step "Resuming with the existing WGS84 LiDAR DEM: $dtmWgs84Path"
    } else {
        Write-Step "Rasterizing $($copcFiles.Count) local COPC files into a ground DEM"
        Invoke-NativeTool $pdalCommand @('pipeline', $pipelinePath)

        $dtmSourceForWarp = $dtmSourcePath
        if ($fillDistance -gt 0) {
            Write-Step 'Filling gaps in the source DEM'
            Invoke-FillNoData $dtmSourcePath $dtmSourceFilledPath $fillDistance $fillSmoothIterations
            $dtmSourceForWarp = $dtmSourceFilledPath
        } else {
            Write-Step 'Retaining unsupported source cells as NoData'
        }

        if ($applyVerticalTransform) {
            $warpSourceCrs = $sourceCompoundCrs
            $warpTargetCrs = $target3dCrs
            Write-Step "Transforming horizontal coordinates and vertical datum ($warpSourceCrs -> $warpTargetCrs)"
        } else {
            $warpSourceCrs = $sourceHorizontalCrs
            $warpTargetCrs = 'EPSG:4326'
            Write-Step "Transforming horizontal coordinates only ($warpSourceCrs -> $warpTargetCrs)"
        }

        Invoke-NativeTool $gdalWarpCommand @(
            '--config', 'PROJ_NETWORK', 'ON', '-overwrite',
            '-s_srs', $warpSourceCrs, '-t_srs', $warpTargetCrs,
            '-r', 'bilinear', '-srcnodata', '-9999', '-dstnodata', '-9999',
            '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE',
            $dtmSourceForWarp, $dtmWgs84Path
        )
    }

    Set-RasterCrs $dtmWgs84Path 'EPSG:4326'

    if ($backgroundDem) {
        Write-Step 'Merging supported LiDAR ground cells over the background DEM'
        $gridInfoLines = Invoke-NativeTool $gdalInfoCommand @('-nomd', $dtmWgs84Path) -Capture
        $gridInfoText = ($gridInfoLines | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
        $numberPattern = '[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?'
        $sizeMatch = [regex]::Match($gridInfoText, '(?m)^Size is\s+(\d+),\s*(\d+)\s*$')
        $originMatch = [regex]::Match($gridInfoText, "(?m)^Origin\s*=\s*\(\s*($numberPattern)\s*,\s*($numberPattern)\s*\)\s*$")
        $pixelMatch = [regex]::Match($gridInfoText, "(?m)^Pixel Size\s*=\s*\(\s*($numberPattern)\s*,\s*($numberPattern)\s*\)\s*$")
        if (-not $sizeMatch.Success -or -not $originMatch.Success -or -not $pixelMatch.Success) {
            throw "Unable to determine the LiDAR DEM grid from gdalinfo output:`n$gridInfoText"
        }
        $invariant = [Globalization.CultureInfo]::InvariantCulture
        $gridWidth = [int]$sizeMatch.Groups[1].Value
        $gridHeight = [int]$sizeMatch.Groups[2].Value
        $originX = [double]::Parse($originMatch.Groups[1].Value, [Globalization.NumberStyles]::Float, $invariant)
        $originY = [double]::Parse($originMatch.Groups[2].Value, [Globalization.NumberStyles]::Float, $invariant)
        $pixelX = [double]::Parse($pixelMatch.Groups[1].Value, [Globalization.NumberStyles]::Float, $invariant)
        $pixelY = [double]::Parse($pixelMatch.Groups[2].Value, [Globalization.NumberStyles]::Float, $invariant)
        $oppositeX = $originX + ($pixelX * $gridWidth)
        $oppositeY = $originY + ($pixelY * $gridHeight)
        $minimumX = [Math]::Min($originX, $oppositeX)
        $maximumX = [Math]::Max($originX, $oppositeX)
        $minimumY = [Math]::Min($originY, $oppositeY)
        $maximumY = [Math]::Max($originY, $oppositeY)
        Invoke-NativeTool $gdalWarpCommand @(
            '--config', 'PROJ_NETWORK', 'ON', '-overwrite', '-multi',
            '-wo', 'NUM_THREADS=ALL_CPUS',
            '-t_srs', 'EPSG:4326', '-te_srs', 'EPSG:4326',
            '-te',
            $minimumX.ToString($invariant),
            $minimumY.ToString($invariant),
            $maximumX.ToString($invariant),
            $maximumY.ToString($invariant),
            '-ts', [string]$gridWidth, [string]$gridHeight,
            '-r', 'bilinear', '-dstnodata', '-9999',
            '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'BIGTIFF=IF_SAFER',
            $backgroundDem, $dtmWgs84Path, $dtmReadyPath
        )
        Set-RasterCrs $dtmReadyPath 'EPSG:4326'
    } elseif ($fillDistance -gt 0) {
        Write-Step 'Filling reprojection edge cells and assigning the 2D WGS84 raster CRS'
        Invoke-FillNoData $dtmWgs84Path $dtmReadyPath $fillDistance $fillSmoothIterations
        Set-RasterCrs $dtmReadyPath 'EPSG:4326'
    } else {
        Write-Step 'Preparing the sparse WGS84 LiDAR DEM without gap filling'
        Copy-Item -LiteralPath $dtmWgs84Path -Destination $dtmReadyPath
    }

    Write-Step 'Validating the prepared DEM'
    $gdalInfoLines = Invoke-NativeTool $gdalInfoCommand @('-stats', $dtmReadyPath) -Capture
    $gdalInfoText = $gdalInfoLines -join [Environment]::NewLine
    Write-Host $gdalInfoText
    $gdalInfoPath = Join-Path $runPath 'dtm-ready.gdalinfo.txt'
    [IO.File]::WriteAllText($gdalInfoPath, $gdalInfoText, (New-Object Text.UTF8Encoding($false)))

    $validMatch = [regex]::Match($gdalInfoText, 'STATISTICS_VALID_PERCENT=([0-9.]+)')
    if (-not $validMatch.Success) { throw 'Unable to determine the valid-pixel percentage from gdalinfo.' }
    $validPercent = [double]::Parse($validMatch.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
    if ($validPercent -lt $minimumValidPercent) {
        throw "The DEM is only $validPercent% valid, below MinimumValidPercent ($minimumValidPercent%). Check the input bounds and ground classification."
    }
    if ($validPercent -lt 99.999) {
        Write-Warning "The DEM is $validPercent% valid. Remaining NoData cells will be retained so Mago can generate adaptive terrain only where elevation data exists."
    }

    Write-Step 'Generating quantized-mesh terrain tiles with Mago 3DTerrainer'
    $magoArguments = @(
        "-Xmx${magoMaxHeapGb}g",
        '-jar', $magoTerrainJar,
        '--input', $dtmReadyPath,
        '--output', $terrainPath,
        '--nodataValue', '-9999',
        '--calculateNormals',
        '--intensity', $magoIntensity.ToString([Globalization.CultureInfo]::InvariantCulture),
        '--rasterMaxSize', [string]$magoRasterMaxSize,
        '--mosaicSize', [string]$magoMosaicSize,
        '--interpolationType', 'bilinear'
    )
    if ($magoMaxDepth) { $magoArguments += @('--maxDepth', $magoMaxDepth) }
    Invoke-NativeTool $javaCommand $magoArguments
} finally {
    $env:PROJ_NETWORK = $previousProjNetwork
}

$layerPath = Join-Path $terrainPath 'layer.json'
if (-not (Test-Path -LiteralPath $layerPath -PathType Leaf)) { throw 'Terrain generation did not produce layer.json.' }
$layer = Get-Content -LiteralPath $layerPath -Raw | ConvertFrom-Json
if (-not $layer.tiles) { throw 'layer.json does not contain a tile URL template.' }

$firstTile = Get-ChildItem -LiteralPath $terrainPath -Filter '*.terrain' -File -Recurse | Select-Object -First 1
if (-not $firstTile) { throw 'Terrain generation did not produce any .terrain tiles.' }
$tileCount = (Get-ChildItem -LiteralPath $terrainPath -Filter '*.terrain' -File -Recurse | Measure-Object).Count

$stream = [IO.File]::OpenRead($firstTile.FullName)
try {
    $firstByte = $stream.ReadByte()
    $secondByte = $stream.ReadByte()
} finally {
    $stream.Dispose()
}
$terrainTilesAreGzip = $firstByte -eq 0x1f -and $secondByte -eq 0x8b
$terrainEncodingInstruction = if ($terrainTilesAreGzip) {
    'Content-Encoding: gzip'
} else {
    'no Content-Encoding'
}

$providerSnippet = @"
terrainProvider: new Cesium.CesiumTerrainProvider({
    url: '$($publicTerrainUrl.TrimEnd('/'))/',
    requestVertexNormals: true,
}),
"@
$providerPath = Join-Path $runPath 'cesium-provider.js'
[IO.File]::WriteAllText($providerPath, $providerSnippet, (New-Object Text.UTF8Encoding($false)))

$uploadInstructions = @"
Upload the CONTENTS of:
$terrainPath

to:
$($destinationS3Uri.TrimEnd('/'))/

Object metadata:
  layer.json  Content-Type: application/json; no Content-Encoding
  *.terrain   Content-Type: application/vnd.quantized-mesh; $terrainEncodingInstruction

Expected public manifest:
$($publicTerrainUrl.TrimEnd('/'))/layer.json
"@
$uploadInstructionsPath = Join-Path $runPath 'UPLOAD.txt'
[IO.File]::WriteAllText($uploadInstructionsPath, $uploadInstructions, (New-Object Text.UTF8Encoding($false)))

Write-Step 'Terrain generation completed'
Write-Host "Run directory:  $runPath"
Write-Host "Upload folder: $terrainPath"
Write-Host "Terrain tiles: $tileCount"
Write-Host "Tile encoding: $(if ($terrainTilesAreGzip) { 'gzip' } else { 'uncompressed' })"
Write-Host "Instructions:  $uploadInstructionsPath"
Write-Host "Cesium code:  $providerPath"
