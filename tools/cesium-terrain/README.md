# COPC to Cesium terrain workflow

This workflow converts a directory of local COPC files into a Cesium
quantized-mesh terrain tileset. The Windows PowerShell entry point is intended
to run on the Windows machine where the source files already reside. It never
uploads or deletes remote objects.

The workflow uses:

- PDAL to select or classify ground points and rasterize them into a DEM.
- GDAL/PROJ to fill raster gaps and transform NAVD88 heights to WGS84
  ellipsoidal heights.
- Mago 3DTerrainer on Windows to create Cesium quantized-mesh tiles. The Linux
  alternative retains its containerized Cesium Terrain Builder step.

Every invocation creates a new timestamped directory under `WORK_DIR`. Existing
local runs are never removed. Existing S3 objects are retained unless
`DELETE_STALE_S3_OBJECTS=true` is explicitly configured.

## Windows requirements

- Windows 10/11 or Windows Server with PowerShell 5.1 or newer.
- Native `pdal` and GDAL. GDAL 3.11+ unified commands and older standalone
  utility scripts are supported.
- A Java 21 or newer runtime.
- The Mago 3DTerrainer release JAR, version 1.14.2 or newer recommended.
- Outbound HTTPS access to PROJ's transformation-grid service.

The PowerShell workflow runs native executables and does not require Docker or
Conda activation. Install GDAL into the existing PDAL environment by invoking
`conda.exe` with absolute paths. For example:

```powershell
& 'C:\ProgramData\miniconda3\Scripts\conda.exe' install `
  --prefix 'C:\ProgramData\miniconda3\envs\lidar' `
  --channel conda-forge `
  gdal
```

Replace both paths if Miniconda is installed under a user profile or another
directory. `--prefix` targets the exact environment and does not depend on its
name or an activated shell.

Download the current Mago 3DTerrainer JAR from its official releases page:

```text
https://github.com/Gaia3D/mago-3d-terrainer/releases
```

Place the JAR in a stable local directory that does not require administrator
access, for example:

```text
C:\AppDev\NJDOT-footprint-handoff\tools\mago-3d-terrainer.jar
```

Mago's current release requires Java 21 or newer. A system-wide Java install is
not required. Download and expand Microsoft's portable Windows x64 JDK 21 ZIP
inside the handoff directory:

```powershell
$toolsDir = 'C:\AppDev\NJDOT-footprint-handoff\tools'
$javaZip = Join-Path $toolsDir 'microsoft-jdk-21-windows-x64.zip'
$javaDir = Join-Path $toolsDir 'jdk-21'

New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
Invoke-WebRequest `
  -Uri 'https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip' `
  -OutFile $javaZip
Expand-Archive -LiteralPath $javaZip -DestinationPath $javaDir -Force

$javaExe = Get-ChildItem -LiteralPath $javaDir -Filter java.exe -File -Recurse |
  Where-Object { $_.FullName -like '*\bin\java.exe' } |
  Select-Object -First 1 -ExpandProperty FullName

& $javaExe -version
$javaExe
```

The last command prints the absolute `java.exe` path. Copy that value into
`JavaCommand` in the configuration file. This method does not run an installer,
request elevation, or require `JAVA_HOME` or PATH changes. The script also
continues to search common system JDK 21 installation directories when
`JavaCommand` is empty.

The terrain script uses the same discovery approach as
`lidar.organization\convert_package_las_to_copc.ps1`: it checks `pdal.exe` on
PATH, the active Conda prefix, standard Miniforge/Miniconda/Anaconda locations,
and environments returned by `conda env list --json`. It then derives the
absolute environment directory from the discovered executable.

Normally, leave the Conda environment setting empty and configure Java and the
downloaded JAR:

```powershell
CondaEnvironmentDir = ''
JavaCommand = 'C:\AppDev\NJDOT-footprint-handoff\tools\jdk-21\jdk-21.0.x+yy\bin\java.exe'
MagoTerrainJar = 'C:\AppDev\NJDOT-footprint-handoff\tools\mago-3d-terrainer.jar'
MagoMaxHeapGb = 12
```

Replace the versioned JDK directory in `JavaCommand` with the exact value
printed by the PowerShell commands above.

You can still provide an absolute `CondaEnvironmentDir` when automatic
discovery finds the wrong environment.

The script derives the PDAL/GDAL commands from `Library\bin` and `Scripts`. For
current GDAL releases it uses `gdal raster fill-nodata` and `gdal raster edit`;
for older releases it falls back to `gdal_fillnodata` and `gdal_edit`. It also
supplies the environment's absolute GDAL and PROJ data directories only while a
tool is running, then restores them. No machine- or user-level environment
variables are created or changed.

Verify the complete native toolchain without activating Conda:

```powershell
& 'C:\ProgramData\miniconda3\envs\lidar\Library\bin\pdal.exe' --version
& 'C:\ProgramData\miniconda3\envs\lidar\Library\bin\gdalinfo.exe' --version
& 'C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot\bin\java.exe' -version
& 'C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot\bin\java.exe' `
  -jar 'C:\Tools\mago-3d-terrainer\mago-3d-terrainer.jar' `
  --help
```

## Windows configuration and execution

Copy the PowerShell configuration and edit the local paths:

```powershell
Copy-Item `
  .\tools\cesium-terrain\terrain.config.psd1.example `
  D:\lidar\terrain.config.psd1

notepad D:\lidar\terrain.config.psd1
```

Run the workflow:

```powershell
Set-ExecutionPolicy -Scope Process Bypass

.\tools\cesium-terrain\generate-terrain.ps1 `
  -Config D:\lidar\terrain.config.psd1
```

If a run stops after `dtm-wgs84.tif` has been created, resume from that run
without repeating the PDAL rasterization:

```powershell
.\tools\cesium-terrain\generate-terrain.ps1 `
  -Config D:\lidar\terrain.config.psd1 `
  -ResumeRun D:\lidar\terrain-work\20260923T200149Z-12345
```

`ResumeRun` must be the absolute timestamped run directory and must contain
`dtm-wgs84.tif`. The merge, validation, and terrain tiling stages are rerun.

The Windows script writes `UPLOAD.txt` and `cesium-provider.js` into the run
directory. `UPLOAD.txt` identifies the exact local folder to upload and the
required object metadata.

## Linux alternative

The Bash scripts remain available for a Linux processing host. They require:

- Linux with Bash 4 or newer.
- Docker Engine with permission to run containers.
- AWS CLI v2 when uploads are enabled.
- AWS credentials with `s3:ListBucket`, `s3:PutObject`, and `s3:GetObject`
  access for the configured bucket and prefix.
- Outbound HTTPS access to GHCR and to PROJ's transformation-grid service.

The current user must be able to read all input COPCs and write to `WORK_DIR`.

### Configure Linux

Copy the example configuration outside the Git checkout and edit it:

```bash
cp tools/cesium-terrain/terrain.env.example /srv/njdot/terrain.env
chmod 600 /srv/njdot/terrain.env
```

At minimum, set:

```bash
INPUT_DIR=/srv/njdot/copc
WORK_DIR=/srv/njdot/terrain-work
UPLOAD=false
```

`INPUT_DIR` must contain files ending in `.copc.laz`. The script processes all
of them as one continuous terrain surface.

The Route 9 defaults assume:

- Horizontal coordinates: EPSG:3424, New Jersey State Plane US survey feet.
- Vertical coordinates: NAVD88.
- Elevation units: US survey feet.
- Ground points: ASPRS class 2.

Confirm those assumptions against the survey metadata before production use.
An incorrect vertical datum can shift the terrain by roughly the same magnitude
as the viewer's current `-33 m` correction.

### Conservative ground overlay for unclassified corridors

When the source files contain only classification `0`, enable SMRF and keep
only generated class `2` ground points:

```powershell
ClassifyGround = $true
GroundClasses = @(2)
SmrfReturns = 'last,only'
```

For a high-confidence overlay, disable both PDAL's empty-cell fallback and the
large GDAL gap fill. Supply a background-only raster whose elevations are
already WGS84 ellipsoidal heights:

```powershell
DemWindowSize = 0
FillDistance = 0
BackgroundDem = 'C:\absolute\path\to\3dep-background-ellipsoid.tif'
```

The script warps the sparse LiDAR ground raster first, aligns the background to
that exact grid, and mosaics the files in this order:

```text
background DEM -> supported LiDAR ground cells
```

Because GDAL processes multiple warp inputs in order, the LiDAR raster has
priority only where it is valid; its NoData cells reveal the background. Never
use an earlier `dtm-merged.tif` as `BackgroundDem`, because that raster already
contains the LiDAR artifacts the conservative pass is intended to remove.

`DenoiseGroundCandidates = $true` adds a statistical outlier pass after the
ground selection. It can be useful for isolated spikes, but it is disabled by
default because the nearest-neighbor calculation is expensive on very large
projects.

Linear corridors commonly occupy only part of their rectangular GeoTIFF bounds.
`MinimumValidPercent` defaults to `1.0`; it catches empty or badly filtered DEMs
without rejecting expected NoData outside the surveyed corridor. Mago 1.14.2
retains that NoData and generates adaptive terrain only where elevation data is
available. Increase the threshold only when the input is expected to cover its
entire rectangular extent.

If bridge decks should support the aerial image, configure:

```bash
GROUND_CLASSES=2,17
```

If the COPCs are unclassified, set `CLASSIFY_GROUND=true`. The supplied SMRF
distances are converted for a source CRS whose linear unit is US survey feet.

### Run on Linux

```bash
chmod +x tools/cesium-terrain/generate-terrain.sh
chmod +x tools/cesium-terrain/build-and-upload.sh

tools/cesium-terrain/generate-terrain.sh \
  --config /srv/njdot/terrain.env
```

`generate-terrain.sh` always passes `--no-upload` to the underlying workflow,
even if the configuration file contains `UPLOAD=true`.

The same run can also be started without a configuration file:

```bash
tools/cesium-terrain/generate-terrain.sh \
  --input-dir /srv/njdot/copc \
  --work-dir /srv/njdot/terrain-work
```

The completed run directory contains:

```text
terrain-work/<run-id>/
  copc-to-dem.json
  dtm-source.tif
  dtm-source-filled.tif
  dtm-wgs84.tif
  dtm-ready.tif
  dtm-ready.gdalinfo.txt
  terrain/
    layer.json
    0/
    1/
    ...
  cesium-provider.js
```

The directory to publish is exactly:

```text
terrain-work/<run-id>/terrain/
```

Upload the contents of that directory—not the enclosing timestamped run
directory—to:

```text
s3://njdot-lidar-streaming-test/Baker-2021-Route9-North-middle10-20260917-101430/terrain/
```

The resulting public manifest should therefore be:

```text
https://njdot-lidar-streaming-test.s3.us-east-1.amazonaws.com/Baker-2021-Route9-North-middle10-20260917-101430/terrain/layer.json
```

The script stops before tiling if the final DEM still contains NoData cells.
Increase `FILL_DISTANCE` or merge the LiDAR surface over a background DEM when
that happens. A background DEM generally gives better results than interpolating
large areas outside a narrow road corridor.

## Manual upload requirements

Every `.terrain` object must use this content type:

```text
Content-Type: application/vnd.quantized-mesh
```

The script inspects the generated tile bytes. Its `UPLOAD.txt` says whether the
`.terrain` objects also require `Content-Encoding: gzip`. Do not apply that
encoding when the script reports uncompressed tiles. Upload `layer.json` as
`application/json` without a content encoding.

The bucket CORS policy must allow `GET` and `HEAD` from the viewer origin. The
existing COPC CORS policy can also cover the terrain prefix.

## Connect the generated terrain to the viewer

The script writes a ready-to-copy `cesium-provider.js`. Its contents will look
like this:

```js
terrainProvider: new Cesium.CesiumTerrainProvider({
    url: 'https://njdot-lidar-streaming-test.s3.us-east-1.amazonaws.com/Baker-2021-Route9-North-middle10-20260917-101430/terrain/',
    requestVertexNormals: true,
}),
```

Place that property beside `imageryProvider` in the options passed to
`new Cesium.Viewer(...)` in `examples/copc_cesium.html`.

The example also accepts the terrain URL as a query parameter, which is useful
for testing a newly generated run without changing source code:

```text
http://localhost/lidar.viewer/examples/copc_cesium.html?r=all&c=rgba&terrain=https%3A%2F%2Fnjdot-lidar-streaming-test.s3.us-east-1.amazonaws.com%2FBaker-2021-Route9-North-middle10-20260917-101430%2Fterrain%2F
```

The terrain is transformed to ellipsoidal height, but the original COPCs are
not modified. Keep the Potree vertical offset near the local NAVD88-to-WGS84
geoid separation until the viewer applies a grid-based vertical transform to
the point cloud itself.

## Operational notes

- Start with `DEM_RESOLUTION=3.0` for a faster trial, then use `1.0` for the
  production road surface.
- Do not enable `DELETE_STALE_S3_OBJECTS` until the output prefix is dedicated
  exclusively to this workflow.
- Use Mago 3DTerrainer 1.14.2 or newer; that release fixes raster alignment for
  large rasters split during standardization.
- Increase `MagoMaxHeapGb` if Java reports an out-of-memory error. Keep the
  value below the server's available physical memory.
