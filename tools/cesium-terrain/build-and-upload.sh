#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
    cat <<'EOF'
Build Cesium quantized-mesh terrain from local COPC files and optionally upload it to S3.

Usage:
  ./build-and-upload.sh --config ./terrain.env
  ./build-and-upload.sh --input-dir /srv/copc --work-dir /srv/terrain-work \
      --s3-uri s3://my-bucket/terrain/route9

Options:
  --config FILE       Load configuration from a trusted shell-format file.
  --input-dir DIR     Directory containing *.copc.laz files.
  --work-dir DIR      Parent directory for timestamped run outputs.
  --s3-uri URI        Destination such as s3://bucket/terrain/route9.
  --no-upload         Build and validate locally without uploading.
  --no-pull           Do not refresh the Docker images before running.
  -h, --help          Show this help.

Command-line values override values loaded from the configuration file.
EOF
}

die() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

log() {
    printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

is_true() {
    [[ "${1,,}" == "true" ]]
}

require_number() {
    local name="$1"
    local value="$2"
    [[ "$value" =~ ^-?[0-9]+([.][0-9]+)?$ ]] || die "$name must be numeric; received '$value'."
}

require_crs() {
    local name="$1"
    local value="$2"
    [[ "$value" =~ ^[A-Za-z0-9:._+-]+$ ]] || die "$name contains unsupported characters: '$value'."
}

CONFIG_FILE=""
ORIGINAL_ARGS=("$@")
for ((i = 0; i < ${#ORIGINAL_ARGS[@]}; i++)); do
    if [[ "${ORIGINAL_ARGS[$i]}" == "--config" ]]; then
        ((i + 1 < ${#ORIGINAL_ARGS[@]})) || die "--config requires a file path."
        CONFIG_FILE="${ORIGINAL_ARGS[$((i + 1))]}"
        break
    fi
done

if [[ -n "$CONFIG_FILE" ]]; then
    [[ -f "$CONFIG_FILE" ]] || die "Configuration file not found: $CONFIG_FILE"
    # The configuration file is shell syntax and must be trusted.
    # shellcheck source=/dev/null
    source "$CONFIG_FILE"
fi

: "${INPUT_DIR:=}"
: "${WORK_DIR:=}"
: "${S3_URI:=}"
: "${UPLOAD:=false}"
: "${PULL_IMAGES:=true}"
: "${DELETE_STALE_S3_OBJECTS:=false}"
: "${RUN_ID:=$(date -u +'%Y%m%dT%H%M%SZ')-$$}"

: "${PDAL_IMAGE:=ghcr.io/pdal/pdal:2.10.2}"
: "${CTB_IMAGE:=ghcr.io/tum-gis/ctb-quantized-mesh:latest}"

: "${SOURCE_HORIZONTAL_CRS:=EPSG:3424}"
: "${SOURCE_COMPOUND_CRS:=EPSG:3424+5703}"
: "${TARGET_3D_CRS:=EPSG:4979}"
: "${APPLY_VERTICAL_TRANSFORM:=true}"
: "${Z_SCALE:=0.3048006096012192}"

: "${GROUND_CLASSES:=2}"
: "${CLASSIFY_GROUND:=false}"
: "${SMRF_CELL:=3.280833333}"
: "${SMRF_WINDOW:=59.055}"
: "${SMRF_THRESHOLD:=1.640416667}"
: "${SMRF_SLOPE:=0.15}"

: "${DEM_RESOLUTION:=1.0}"
: "${DEM_RADIUS:=1.5}"
: "${DEM_WINDOW_SIZE:=5}"
: "${FILL_DISTANCE:=500}"
: "${FILL_SMOOTH_ITERATIONS:=2}"

: "${AWS_PROFILE:=}"
: "${AWS_REGION:=us-east-1}"
: "${PUBLIC_BASE_URL:=}"
: "${TERRAIN_CACHE_CONTROL:=public,max-age=31536000,immutable}"

set -- "${ORIGINAL_ARGS[@]}"
while (($#)); do
    case "$1" in
        --config)
            (($# >= 2)) || die "--config requires a file path."
            shift 2
            ;;
        --input-dir)
            (($# >= 2)) || die "--input-dir requires a directory."
            INPUT_DIR="$2"
            shift 2
            ;;
        --work-dir)
            (($# >= 2)) || die "--work-dir requires a directory."
            WORK_DIR="$2"
            shift 2
            ;;
        --s3-uri)
            (($# >= 2)) || die "--s3-uri requires an S3 URI."
            S3_URI="$2"
            shift 2
            ;;
        --no-upload)
            UPLOAD=false
            shift
            ;;
        --no-pull)
            PULL_IMAGES=false
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "Unknown option: $1"
            ;;
    esac
done

[[ -n "$INPUT_DIR" ]] || die "INPUT_DIR is required."
[[ -d "$INPUT_DIR" ]] || die "COPC input directory does not exist: $INPUT_DIR"
[[ -n "$WORK_DIR" ]] || die "WORK_DIR is required."
[[ "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] || die "RUN_ID may contain only letters, numbers, periods, underscores, and dashes."

for value in "$UPLOAD" "$PULL_IMAGES" "$DELETE_STALE_S3_OBJECTS" "$APPLY_VERTICAL_TRANSFORM" "$CLASSIFY_GROUND"; do
    [[ "${value,,}" == "true" || "${value,,}" == "false" ]] || die "Boolean configuration values must be true or false."
done

require_crs SOURCE_HORIZONTAL_CRS "$SOURCE_HORIZONTAL_CRS"
require_crs SOURCE_COMPOUND_CRS "$SOURCE_COMPOUND_CRS"
require_crs TARGET_3D_CRS "$TARGET_3D_CRS"
require_number Z_SCALE "$Z_SCALE"
require_number DEM_RESOLUTION "$DEM_RESOLUTION"
require_number DEM_RADIUS "$DEM_RADIUS"
require_number DEM_WINDOW_SIZE "$DEM_WINDOW_SIZE"
require_number FILL_DISTANCE "$FILL_DISTANCE"
require_number FILL_SMOOTH_ITERATIONS "$FILL_SMOOTH_ITERATIONS"
require_number SMRF_CELL "$SMRF_CELL"
require_number SMRF_WINDOW "$SMRF_WINDOW"
require_number SMRF_THRESHOLD "$SMRF_THRESHOLD"
require_number SMRF_SLOPE "$SMRF_SLOPE"
[[ "$GROUND_CLASSES" =~ ^[0-9]+(,[0-9]+)*$ ]] || die "GROUND_CLASSES must be comma-separated integer class numbers."

command_exists docker || die "Docker is required."
if is_true "$UPLOAD"; then
    command_exists aws || die "AWS CLI is required when UPLOAD=true."
    [[ "$S3_URI" =~ ^s3://[^/]+/.+ ]] || die "S3_URI must include a bucket and prefix, for example s3://bucket/terrain/route9."
fi

INPUT_DIR="$(cd "$INPUT_DIR" && pwd -P)"
mkdir -p "$WORK_DIR"
WORK_DIR="$(cd "$WORK_DIR" && pwd -P)"
RUN_DIR="$WORK_DIR/$RUN_ID"
[[ ! -e "$RUN_DIR" ]] || die "Run directory already exists: $RUN_DIR"
mkdir -p "$RUN_DIR/terrain"

shopt -s nullglob
COPC_FILES=("$INPUT_DIR"/*.copc.laz)
shopt -u nullglob
((${#COPC_FILES[@]} > 0)) || die "No *.copc.laz files were found in $INPUT_DIR"

GROUND_EXPRESSION=""
IFS=',' read -r -a CLASS_IDS <<< "$GROUND_CLASSES"
for class_id in "${CLASS_IDS[@]}"; do
    if [[ -n "$GROUND_EXPRESSION" ]]; then
        GROUND_EXPRESSION+=" || "
    fi
    GROUND_EXPRESSION+="Classification == $class_id"
done

SMRF_STAGE=""
if is_true "$CLASSIFY_GROUND"; then
    SMRF_STAGE=$(cat <<EOF
    {
      "type": "filters.smrf",
      "cell": $SMRF_CELL,
      "window": $SMRF_WINDOW,
      "threshold": $SMRF_THRESHOLD,
      "slope": $SMRF_SLOPE
    },
EOF
)
fi

PIPELINE_FILE="$RUN_DIR/copc-to-dem.json"
cat > "$PIPELINE_FILE" <<EOF
{
  "pipeline": [
    {
      "type": "readers.copc",
      "filename": "/input/*.copc.laz",
      "default_srs": "$SOURCE_HORIZONTAL_CRS"
    },
$SMRF_STAGE
    {
      "type": "filters.expression",
      "expression": "$GROUND_EXPRESSION"
    },
    {
      "type": "filters.assign",
      "value": "Z = Z * $Z_SCALE"
    },
    {
      "type": "writers.gdal",
      "filename": "/work/dtm-source.tif",
      "resolution": $DEM_RESOLUTION,
      "radius": $DEM_RADIUS,
      "output_type": "idw",
      "window_size": $DEM_WINDOW_SIZE,
      "data_type": "float",
      "nodata": -9999,
      "gdalopts": "TILED=YES,COMPRESS=DEFLATE"
    }
  ]
}
EOF

HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

run_geo() {
    docker run --rm \
        --user "$HOST_UID:$HOST_GID" \
        -e HOME=/tmp \
        -e PROJ_NETWORK=ON \
        -v "$INPUT_DIR:/input:ro" \
        -v "$RUN_DIR:/work" \
        "$PDAL_IMAGE" "$@"
}

if is_true "$PULL_IMAGES"; then
    log "Pulling processing images"
    docker pull "$PDAL_IMAGE"
    docker pull "$CTB_IMAGE"
fi

log "Rasterizing ${#COPC_FILES[@]} COPC files into a ground DEM"
run_geo pdal pipeline /work/copc-to-dem.json

log "Filling gaps in the source DEM"
run_geo sh -euc '
    fill_command="$(command -v gdal_fillnodata || command -v gdal_fillnodata.py || true)"
    [ -n "$fill_command" ] || { echo "gdal_fillnodata was not found" >&2; exit 1; }
    "$fill_command" -md "$1" -si "$2" /work/dtm-source.tif /work/dtm-source-filled.tif
' sh "$FILL_DISTANCE" "$FILL_SMOOTH_ITERATIONS"

if is_true "$APPLY_VERTICAL_TRANSFORM"; then
    WARP_SOURCE_CRS="$SOURCE_COMPOUND_CRS"
    WARP_TARGET_CRS="$TARGET_3D_CRS"
    log "Transforming horizontal coordinates and vertical datum ($WARP_SOURCE_CRS -> $WARP_TARGET_CRS)"
else
    WARP_SOURCE_CRS="$SOURCE_HORIZONTAL_CRS"
    WARP_TARGET_CRS="EPSG:4326"
    log "Transforming horizontal coordinates only ($WARP_SOURCE_CRS -> $WARP_TARGET_CRS)"
fi

run_geo gdalwarp \
    --config PROJ_NETWORK ON \
    -overwrite \
    -s_srs "$WARP_SOURCE_CRS" \
    -t_srs "$WARP_TARGET_CRS" \
    -r bilinear \
    -srcnodata -9999 \
    -dstnodata -9999 \
    -co TILED=YES \
    -co COMPRESS=DEFLATE \
    /work/dtm-source-filled.tif \
    /work/dtm-wgs84.tif

log "Filling reprojection edge cells and assigning the 2D WGS84 raster CRS"
run_geo sh -euc '
    fill_command="$(command -v gdal_fillnodata || command -v gdal_fillnodata.py || true)"
    edit_command="$(command -v gdal_edit || command -v gdal_edit.py || true)"
    [ -n "$fill_command" ] || { echo "gdal_fillnodata was not found" >&2; exit 1; }
    [ -n "$edit_command" ] || { echo "gdal_edit was not found" >&2; exit 1; }
    "$fill_command" -md "$1" -si "$2" /work/dtm-wgs84.tif /work/dtm-ready.tif
    "$edit_command" -a_srs EPSG:4326 /work/dtm-ready.tif
' sh "$FILL_DISTANCE" "$FILL_SMOOTH_ITERATIONS"

log "Validating the prepared DEM"
run_geo gdalinfo -stats /work/dtm-ready.tif | tee "$RUN_DIR/dtm-ready.gdalinfo.txt"
VALID_PERCENT="$(grep -Eo 'STATISTICS_VALID_PERCENT=[0-9.]+' "$RUN_DIR/dtm-ready.gdalinfo.txt" | head -n 1 | cut -d= -f2 || true)"
[[ -n "$VALID_PERCENT" ]] || die "Unable to determine the valid-pixel percentage from gdalinfo."
awk -v value="$VALID_PERCENT" 'BEGIN { exit !(value + 0 >= 99.999) }' || \
    die "The DEM is only $VALID_PERCENT% valid. Increase FILL_DISTANCE or merge a background DEM before tiling."

log "Generating quantized-mesh terrain tiles"
docker run --rm \
    --user "$HOST_UID:$HOST_GID" \
    -e HOME=/tmp \
    -v "$RUN_DIR:/data" \
    "$CTB_IMAGE" /bin/bash -euc '
        ctb-tile -f Mesh -C -N -o /data/terrain /data/dtm-ready.tif
        ctb-tile -f Mesh -C -N -l -o /data/terrain /data/dtm-ready.tif
    '

TERRAIN_DIR="$RUN_DIR/terrain"
[[ -s "$TERRAIN_DIR/layer.json" ]] || die "Terrain generation did not produce layer.json."
FIRST_TILE="$(find "$TERRAIN_DIR" -type f -name '*.terrain' -print -quit)"
[[ -n "$FIRST_TILE" ]] || die "Terrain generation did not produce any .terrain tiles."
TILE_COUNT="$(find "$TERRAIN_DIR" -type f -name '*.terrain' | wc -l | tr -d ' ')"
GZIP_MAGIC="$(od -An -tx1 -N2 "$FIRST_TILE" | tr -d '[:space:]')"
[[ "$GZIP_MAGIC" == "1f8b" ]] || die "Generated terrain tiles are not gzip-compressed as expected."
grep -q '"tiles"' "$TERRAIN_DIR/layer.json" || die "layer.json does not contain a tile URL template."

TERRAIN_URL=""
if is_true "$UPLOAD"; then
    S3_URI="${S3_URI%/}"
    AWS_ARGS=()
    [[ -z "$AWS_PROFILE" ]] || AWS_ARGS+=(--profile "$AWS_PROFILE")
    [[ -z "$AWS_REGION" ]] || AWS_ARGS+=(--region "$AWS_REGION")

    SYNC_ARGS=(
        s3 sync "$TERRAIN_DIR/" "$S3_URI/"
        --exclude layer.json
        --content-type application/vnd.quantized-mesh
        --content-encoding gzip
        --cache-control "$TERRAIN_CACHE_CONTROL"
    )
    if is_true "$DELETE_STALE_S3_OBJECTS"; then
        SYNC_ARGS+=(--delete)
    fi

    log "Uploading $TILE_COUNT terrain tiles to $S3_URI"
    aws "${AWS_ARGS[@]}" "${SYNC_ARGS[@]}"
    aws "${AWS_ARGS[@]}" s3 cp \
        "$TERRAIN_DIR/layer.json" "$S3_URI/layer.json" \
        --content-type application/json \
        --cache-control 'no-cache, no-store, must-revalidate'

    S3_TARGET="${S3_URI#s3://}"
    S3_BUCKET="${S3_TARGET%%/*}"
    S3_PREFIX="${S3_TARGET#*/}"
    [[ "$S3_PREFIX" != "$S3_BUCKET" ]] || S3_PREFIX=""
    LAYER_KEY="${S3_PREFIX:+$S3_PREFIX/}layer.json"
    FIRST_TILE_RELATIVE="${FIRST_TILE#"$TERRAIN_DIR"/}"
    FIRST_TILE_KEY="${S3_PREFIX:+$S3_PREFIX/}$FIRST_TILE_RELATIVE"

    log "Verifying uploaded S3 metadata"
    aws "${AWS_ARGS[@]}" s3api head-object --bucket "$S3_BUCKET" --key "$LAYER_KEY" \
        > "$RUN_DIR/uploaded-layer-head.json"
    aws "${AWS_ARGS[@]}" s3api head-object --bucket "$S3_BUCKET" --key "$FIRST_TILE_KEY" \
        > "$RUN_DIR/uploaded-tile-head.json"
    grep -Eq '"ContentEncoding"[[:space:]]*:[[:space:]]*"gzip"' "$RUN_DIR/uploaded-tile-head.json" || \
        die "The uploaded terrain tile is missing Content-Encoding: gzip."

    if [[ -n "$PUBLIC_BASE_URL" ]]; then
        TERRAIN_URL="${PUBLIC_BASE_URL%/}/"
    else
        TERRAIN_URL="https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${S3_PREFIX:+$S3_PREFIX/}"
    fi
else
    TERRAIN_URL="https://your-server.example/terrain/"
fi

cat > "$RUN_DIR/cesium-provider.js" <<EOF
terrainProvider: new Cesium.CesiumTerrainProvider({
    url: '$TERRAIN_URL',
    requestVertexNormals: true,
}),
EOF

log "Terrain workflow completed"
printf 'Run directory: %s\n' "$RUN_DIR"
printf 'Terrain tiles: %s\n' "$TILE_COUNT"
if is_true "$UPLOAD"; then
    printf 'Terrain URL: %s\n' "$TERRAIN_URL"
fi
printf 'Cesium snippet: %s\n' "$RUN_DIR/cesium-provider.js"
