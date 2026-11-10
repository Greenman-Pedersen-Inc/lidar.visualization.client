@{
    # Local Windows directories. InputDir must contain *.copc.laz files.
    InputDir = 'C:\AppDev\NJDOT-footprint-handoff\Baker-2021-Route9-North-middle10-20260917-101430\lidar'
    WorkDir = 'C:\AppDev\NJDOT-footprint-handoff\terrain-work'

    # Optional absolute override. Leave empty to find the PDAL Conda environment
    # the same way as lidar.organization\convert_package_las_to_copc.ps1.
    CondaEnvironmentDir = ''

    # Optional absolute overrides. Leave empty when the tools are in the Conda
    # environment above.
    PdalCommand = ''
    GdalCommand = ''
    GdalWarpCommand = ''
    GdalInfoCommand = ''
    GdalFillNoDataCommand = ''
    GdalEditCommand = ''

    # Mago 3DTerrainer requires Java 21+. JavaCommand may be empty when Java is
    # discoverable. For a portable JDK, set it to the absolute bin\java.exe
    # path. MagoTerrainJar must be the absolute downloaded JAR path.
    JavaCommand = 'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot\bin\java.exe'
    MagoTerrainJar = 'C:\AppDev\NJDOT-footprint-handoff\tools\mago-3d-terrainer-1.14.2-release.jar'
    MagoMaxHeapGb = 12

    # Leave MagoMaxDepth empty to derive it from the GeoTIFF resolution.
    MagoMaxDepth = ''
    MagoIntensity = 4.0
    MagoRasterMaxSize = 4096
    MagoMosaicSize = 8

    # Route 9 coordinate assumptions.
    SourceHorizontalCrs = 'EPSG:3424'
    SourceCompoundCrs = 'EPSG:3424+5703'
    Target3dCrs = 'EPSG:4979'
    ApplyVerticalTransform = $true
    ZScale = 0.3048006096012192

    # ASPRS ground is class 2. Use @(2, 17) to include bridge decks.
    GroundClasses = @(2)

    # Enable only when the COPCs do not already have usable ground classes.
    ClassifyGround = $true
    SmrfCell = 3.280833333
    SmrfWindow = 131.233333333
    SmrfThreshold = 1.640416667
    SmrfSlope = 0.15
    SmrfReturns = 'last,only'

    # Optional second-pass removal of isolated ground candidates. Leave this
    # disabled initially because it is expensive for this 439-million-point
    # dataset; enable it only if the sparse v3 DEM still contains spikes.
    DenoiseGroundCandidates = $false
    OutlierMeanK = 12
    OutlierMultiplier = 2.2

    # These values are in source horizontal units, US survey feet here. A zero
    # window and zero fill retain only cells supported directly by classified
    # ground points. The background DEM supplies every unsupported cell.
    DemResolution = 1.0
    DemRadius = 1.5
    DemWindowSize = 0
    FillDistance = 0
    FillSmoothIterations = 2

    # This must be the background-only WGS84 ellipsoidal raster, never the
    # existing dtm-merged.tif (which already contains the v1 artifacts).
    BackgroundDem = 'C:\AppDev\NJDOT-footprint-handoff\terrain-work\20260922T181353Z-29344\3dep-background-ellipsoid.tif'

    # The surveyed road corridor occupies only part of its rectangular raster.
    # Retain NoData outside the corridor for Mago's adaptive terrain tiling.
    MinimumValidPercent = 95.0

    # These are written to UPLOAD.txt; the script does not upload anything.
    DestinationS3Uri = 's3://njdot-lidar-streaming-test/Baker-2021-Route9-North-middle10-20260917-101430/terrain-v3/'
    PublicTerrainUrl = 'https://njdot-lidar-streaming-test.s3.us-east-1.amazonaws.com/Baker-2021-Route9-North-middle10-20260917-101430/terrain-v3/'
}
