import * as THREE from '../../../libs/three.js/build/three.module.js';
import { EventDispatcher } from '../../EventDispatcher.js';
import { Utils } from '../../utils.js';

let sg = new THREE.SphereGeometry(1, 8, 8);
let sgHigh = new THREE.SphereGeometry(1, 128, 128);

let sm = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
let smHovered = new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0xff0000 });

let raycaster = new THREE.Raycaster();
let currentlyHovered = null;

function applyImageTransform(object, image360) {
    const yaw = image360.orientationMode === 'absolute'
        ? image360.course
        : -image360.course + 90;

    object.rotation.set(
        THREE.Math.degToRad(image360.roll + 90 + image360.rollOffset),
        THREE.Math.degToRad(-image360.pitch + image360.pitchOffset),
        THREE.Math.degToRad(yaw + image360.headingOffset),
        'ZYX',
    );
    object.position.set(...image360.position);
}

let previousView = {
    controls: null,
    position: null,
    target: null,
};

class Image360 {
    constructor(file, time, longitude, latitude, altitude, course, pitch, roll) {
        this.file = file;
        this.time = time;
        this.longitude = longitude;
        this.latitude = latitude;
        this.altitude = altitude;
        this.course = course;
        this.pitch = pitch;
        this.roll = roll;
        this.mesh = null;
        this.orientationMode = 'legacy';
        this.headingOffset = 0;
        this.pitchOffset = 0;
        this.rollOffset = 0;
    }
}

export class Images360 extends EventDispatcher {
    constructor(viewer) {
        super();

        this.viewer = viewer;

        this.selectingEnabled = true;

        this.images = [];
        this.node = new THREE.Object3D();

        this.onPointerMove = (event) => {
            // calculate pointer position in normalized device coordinates
            // (-1 to +1) for both components

            console.log(1);
        };

        this.sphere = new THREE.Mesh(sgHigh, sm);
        this.sphere.visible = false;
        this.sphere.scale.set(1000, 1000, 1000);
        this.node.add(this.sphere);
        this._visible = true;
        // this.node.add(label);

        this.focusedImage = null;
        this.loadToken = 0;
        this.textureCache = [];
        this.arrowHoverIntersect = this.arrowHoverIntersect.bind(this);

        let elUnfocus = document.createElement('input');
        elUnfocus.className = 'unfocus-button'
        elUnfocus.type = 'button';
        elUnfocus.value = 'Exit 360°';
        elUnfocus.addEventListener('click', () => this.unfocus());
        this.elUnfocus = elUnfocus;

        this.domRoot = viewer.renderer.domElement.parentElement;
        this.domRoot.appendChild(elUnfocus);
        this.elUnfocus.style.display = 'none';

        this.onViewerUpdate = () => this.update();
        viewer.addEventListener('update', this.onViewerUpdate);
        viewer.inputHandler.addInputListener(this);

        this.onMouseDown = () => {
            if (currentlyHovered && currentlyHovered.image360) {
                this.focus(currentlyHovered.image360);
            }
        };
        this.addEventListener('mousedown', this.onMouseDown);
    }

    set visible(visible) {
        if (this._visible === visible) {
            return;
        }

        for (const image of this.images) {
            image.mesh.visible = visible && this.focusedImage == null;
        }

        this.sphere.visible = visible && this.focusedImage != null;
        this._visible = visible;
        this.dispatchEvent({
            type: 'visibility_changed',
            images: this,
        });
    }

    get visible() {
        return this._visible;
    }

    focus(image360, refocus = false) {
        if (!image360) {
            return;
        }

        if (this.focusedImage !== null) {
            this.unfocus({ restoreView: !refocus });
        }

        if (!refocus) {
            previousView = {
                controls: this.viewer.controls,
                position: this.viewer.scene.view.position.clone(),
                target: this.viewer.scene.view.getPivot(),
            };
        }

        this.viewer.setControls(this.viewer.orbitControls);
        this.viewer.orbitControls.doubleClockZoomEnabled = false;

        for (let image of this.images) {
            image.mesh.visible = false;
        }

        this.selectingEnabled = false;

        this.sphere.visible = false;

        const loadToken = ++this.loadToken;
        this.load(image360).then(() => {
            if (loadToken !== this.loadToken || this.focusedImage !== image360) {
                return;
            }

            this.sphere.visible = true;
            this.sphere.material.map = image360.texture;
            this.sphere.material.needsUpdate = true;

            if (this.node.children.map((object) => object.uuid).indexOf(image360.forwardArrow.uuid) >= 0) {
                image360.forwardArrow.visible = image360.nextIndex !== image360.index;
            } else {
                this.node.add(image360.forwardArrow);
                image360.forwardArrow.visible = image360.nextIndex !== image360.index;
            }
            if (this.node.children.map((object) => object.uuid).indexOf(image360.backwardArrow.uuid) >= 0) {
                image360.backwardArrow.visible = image360.previousIndex !== image360.index;
            } else {
                this.node.add(image360.backwardArrow);
                image360.backwardArrow.visible = image360.previousIndex !== image360.index;
            }
        }).catch((error) => {
            console.error(`Unable to load 360 image: ${image360.file}`, error);
        });
        applyImageTransform(this.sphere, image360);

        let target = new THREE.Vector3(...image360.position);
        let dir = target.clone().sub(this.viewer.scene.view.position).normalize();
        let move = dir.multiplyScalar(0.000001);
        let newCamPos = target.clone().sub(move);

        this.viewer.scene.view.setView(newCamPos, target, 500);
        window.addEventListener('click', this.arrowHoverIntersect);

        this.focusedImage = image360;

        this.elUnfocus.style.display = '';
        this.dispatchEvent({ type: 'focus', image: image360 });
    }

    arrowHoverIntersect(event) {
        let images360 = this;
        let mouse = this.viewer.inputHandler.mouse;
        let camera = this.viewer.scene.getActiveCamera();
        let domElement = this.viewer.renderer.domElement;

        let ray = Utils.mouseToRay(mouse, camera, domElement.clientWidth, domElement.clientHeight);

        // let tStart = performance.now();
        raycaster.ray.copy(ray);

        let intersections = raycaster.intersectObjects(images360.node.children);

        if (intersections.length === 0) {
            // label.visible = false;

            return;
        } else if (intersections.length > 1) {
            const focusedImage = images360.focusedImage;
            if (!focusedImage) {
                return;
            }
            const hit = intersections.find((intersection) =>
                intersection.object === focusedImage.forwardArrow || intersection.object === focusedImage.backwardArrow
            );

            if (hit && hit.object === focusedImage.forwardArrow) {
                images360.refocus(images360.images[focusedImage.nextIndex]);
            } else if (hit && hit.object === focusedImage.backwardArrow) {
                images360.refocus(images360.images[focusedImage.previousIndex]);
            }
        }
    }

    refocus(image360) {
        this.unfocus({ restoreView: false });
        this.focus(image360, true);
    }

    unfocus(options = {}) {
        const restoreView = options.restoreView !== false;
        window.removeEventListener('click', this.arrowHoverIntersect);
        this.loadToken++;

        this.selectingEnabled = true;

        for (let image of this.images) {
            image.mesh.visible = true;
            image.forwardArrow.visible = false;
            image.backwardArrow.visible = false;
        }

        let image = this.focusedImage;

        if (image === null) {
            return;
        }

        this.sphere.material.map = null;
        this.sphere.material.needsUpdate = true;
        this.sphere.visible = false;

        this.viewer.orbitControls.doubleClockZoomEnabled = true;
        if (restoreView && previousView.controls && previousView.position && previousView.target) {
            this.viewer.setControls(previousView.controls);
            this.viewer.scene.view.setView(previousView.position, previousView.target, 500);
        }

        this.focusedImage = null;

        this.elUnfocus.style.display = 'none';
        this.dispatchEvent({ type: 'unfocus', image: image });
    }

    dispose() {
        this.unfocus();
        this.viewer.removeEventListener('update', this.onViewerUpdate);
        this.viewer.inputHandler.removeInputListener(this);
        this.removeEventListener('mousedown', this.onMouseDown);
        this.elUnfocus.remove();

        for (const image of this.images) {
            if (image.texture) {
                image.texture.dispose();
                image.texture = null;
            }
            image.forwardArrow.geometry.dispose();
            image.forwardArrow.material.dispose();
            image.backwardArrow.geometry.dispose();
            image.backwardArrow.material.dispose();
        }

        this.textureCache = [];
    }

    load(image360) {
        if (image360.texture) {
            return Promise.resolve(image360.texture);
        }

        return new Promise((resolve, reject) => {
            let texture = new THREE.TextureLoader().load(image360.file, () => {
                this.textureCache = this.textureCache.filter((image) => image !== image360);
                this.textureCache.push(image360);

                while (this.textureCache.length > 3) {
                    const expired = this.textureCache.shift();
                    if (expired !== this.focusedImage && expired.texture) {
                        expired.texture.dispose();
                        expired.texture = null;
                    }
                }

                resolve(texture);
            }, undefined, (error) => {
                image360.texture = null;
                reject(error);
            });
            texture.wrapS = THREE.RepeatWrapping;
            texture.repeat.x = -1;

            image360.texture = texture;
        });
    }

    handleHovering() {
        let mouse = this.viewer.inputHandler.mouse;
        let camera = this.viewer.scene.getActiveCamera();
        let domElement = this.viewer.renderer.domElement;

        let ray = Utils.mouseToRay(mouse, camera, domElement.clientWidth, domElement.clientHeight);

        // let tStart = performance.now();
        raycaster.ray.copy(ray);
        let intersections = raycaster.intersectObjects(this.node.children);

        if (intersections.length === 0) {
            // label.visible = false;

            return;
        }

        let intersection = intersections[0];
        currentlyHovered = intersection.object;
        currentlyHovered.material = smHovered;
    }

    update() {
        let { viewer } = this;

        if (currentlyHovered) {
            currentlyHovered.material = sm;
            currentlyHovered = null;
        }

        if (this.selectingEnabled) {
            this.handleHovering();
        }
    }
}

export class Images360Loader {
    static async load(imageryPath, imageryDataFile, viewer, params = {}) {
        // Keep the original three-argument API working for existing Potree examples.
        if (typeof imageryDataFile !== 'string') {
            params = viewer || {};
            viewer = imageryDataFile;
            imageryDataFile = 'coordinates.txt';
        }

        function drawNavigationArrow(initialPosition, finalPosition) {
            let initial = initialPosition.clone();
            let final = finalPosition.clone();

            let radius = 0.5;
            let height = 3.5;
            let geometry = new THREE.ConeGeometry(radius, height, 24);
            geometry.translate(0, height * 0.5, 0);
            geometry.rotateX(Math.PI * 0.5);

            let material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75 });
            let arrow = new THREE.Mesh(geometry, material);

            initial.z -= 2.5;
            final.z -= 2.5;

            let direction = final.clone().sub(initial);
            if (direction.lengthSq() === 0) {
                arrow.position.copy(initial);
                arrow.visible = false;
                return arrow;
            }

            arrow.position.copy(initial.clone().add(direction.normalize().multiplyScalar(5)));
            arrow.lookAt(final);
            arrow.visible = false;
            return arrow;
        }

        function drawNavigationArrows(image360) {
            image360.forwardArrow = drawNavigationArrow(image360.currentPosition, image360.nextPosition);
            image360.backwardArrow = drawNavigationArrow(image360.currentPosition, image360.previousPosition);
        }

        function calculateBearing(E1, N1, E2, N2) {
            const deltaE = E2 - E1;
            const deltaN = N2 - N1;
            const bearingRad = Math.atan2(deltaE, deltaN);
            let bearingDeg = bearingRad * (180 / Math.PI); // Convert radians to degrees

            if (bearingDeg < 0) {
                bearingDeg += 360; // Normalize the bearing to 0-360 degrees
            }

            return bearingDeg;
        }

        function parseDelimitedLine(line, delimiter) {
            if (delimiter === '\t') {
                return line.split(delimiter).map((token) => token.trim().replace(/^"|"$/g, ''));
            }

            const tokens = [];
            let token = '';
            let quoted = false;
            for (let i = 0; i < line.length; i++) {
                const character = line[i];
                if (character === '"' && line[i + 1] === '"' && quoted) {
                    token += '"';
                    i++;
                } else if (character === '"') {
                    quoted = !quoted;
                } else if (character === delimiter && !quoted) {
                    tokens.push(token.trim());
                    token = '';
                } else {
                    token += character;
                }
            }
            tokens.push(token.trim());
            return tokens;
        }

        function parseRecord(line, headerTokens) {
            const delimiter = line.includes('\t') ? '\t' : ',';
            const tokens = parseDelimitedLine(line, delimiter);
            const normalizedHeaders = headerTokens.map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''));

            const findColumn = (...names) => normalizedHeaders.findIndex((header) => names.includes(header));
            const statePlaneColumns = normalizedHeaders
                .map((header, index) => ({ header, index }))
                .filter(({ header }) => header.includes('stateplane'));

            const selectedPointSchema = findColumn('sri') >= 0 && findColumn('direction') >= 0 && tokens.length >= 14;
            const detectedImageColumn = findColumn('filename', 'imagename', 'imagefile', 'photo', 'panorama');
            const imageColumn = detectedImageColumn >= 0 ? detectedImageColumn : (selectedPointSchema ? 8 : -1);
            const latitudeColumn = findColumn('latstart', 'latitude');
            const longitudeColumn = findColumn('longstart', 'lonstart', 'longitude');
            const detectedElevationColumn = findColumn('elevstart', 'elevation', 'altitude', 'height');
            const detectedRollColumn = findColumn('roll', 'rollxdeg');
            const detectedPitchColumn = findColumn('pitch', 'pitchydeg');
            const detectedBearingColumn = findColumn('bearing', 'yaw', 'yawzdeg', 'course');
            const elevationColumn = detectedElevationColumn >= 0 ? detectedElevationColumn : 4;
            const rollColumn = detectedRollColumn >= 0 ? detectedRollColumn : 5;
            const pitchColumn = detectedPitchColumn >= 0 ? detectedPitchColumn : 6;
            const bearingColumn = detectedBearingColumn >= 0 ? detectedBearingColumn : 7;
            const timeColumn = findColumn('gpstime', 'timestamp', 'time');
            const sourceColumn = findColumn('matchedlasfiles', 'matchedlasfile', 'sourcefile');

            if (imageColumn >= 0 && (selectedPointSchema || statePlaneColumns.length >= 2 || (longitudeColumn >= 0 && latitudeColumn >= 0))) {
                const xColumn = statePlaneColumns.length >= 2 ? statePlaneColumns[0].index : (selectedPointSchema ? 12 : longitudeColumn);
                const yColumn = statePlaneColumns.length >= 2 ? statePlaneColumns[1].index : (selectedPointSchema ? 13 : latitudeColumn);
                return {
                    time: Number(tokens[timeColumn]),
                    filename: tokens[imageColumn],
                    x: Number(tokens[xColumn]),
                    y: Number(tokens[yColumn]),
                    z: Number(tokens[elevationColumn]) * (params.elevationScale || 1),
                    roll: Number(tokens[rollColumn]),
                    pitch: Number(tokens[pitchColumn]),
                    course: Number(tokens[bearingColumn]),
                    source: sourceColumn >= 0 ? tokens[sourceColumn] : '',
                };
            }

            // Orbit CSV format:
            // timestamp, filename, XYZ, direction XYZ, up XYZ, roll, pitch, yaw, omega, phi, kappa
            if (delimiter === ',' && tokens.length >= 17) {
                return {
                    time: Number(tokens[0]),
                    filename: tokens[1],
                    x: Number(tokens[2]),
                    y: Number(tokens[3]),
                    z: Number(tokens[4]),
                    roll: Number(tokens[11]),
                    pitch: Number(tokens[12]),
                    course: Number(tokens[13]),
                };
            }

            // Potree coordinate files exist in both filename-first and time-first forms.
            const filenameFirst = /\.(jpe?g|png|webp)$/i.test(tokens[0]);
            const offset = filenameFirst ? 0 : 1;
            return {
                filename: tokens[offset],
                time: Number(tokens[1 - offset]),
                x: Number(tokens[2]),
                y: Number(tokens[3]),
                z: Number(tokens[4]),
                course: Number(tokens[5]),
                pitch: Number(tokens[6]),
                roll: Number(tokens[7]),
            };
        }

        const transform = params.transform || { forward: (position) => position };
        const dataUrl = `${imageryPath}/${imageryDataFile}`;
        const response = await fetch(dataUrl);
        if (!response.ok) {
            throw new Error(`Unable to load 360 imagery coordinates (${response.status}): ${dataUrl}`);
        }

        const text = await response.text();
        const lines = text.split(/\r?\n/);
        const headerDelimiter = lines[0].includes('\t') ? '\t' : ',';
        const headerTokens = parseDelimitedLine(lines[0], headerDelimiter);
        const records = lines
            .slice(1)
            .filter((line) => line.trim().length > 0)
            .map((line) => parseRecord(line, headerTokens))
            .filter((record) =>
                record.filename &&
                Number.isFinite(record.x) &&
                Number.isFinite(record.y) &&
                Number.isFinite(record.z)
            );

        const normalizeSourceName = (name) => String(name || '')
            .toLowerCase()
            .replace(/\.copc\.laz$/i, '')
            .replace(/\.las$/i, '');
        const sourceNames = (params.sourceNames || []).map(normalizeSourceName);
        const recordsForSources = sourceNames.length > 0 && records.some((record) => record.source)
            ? records.filter((record) => sourceNames.some((name) => normalizeSourceName(record.source).includes(name)))
            : records;
        const bounds = params.metadata && params.metadata.boundingBox;
        const recordsInBounds = bounds ? recordsForSources.filter((record) =>
            record.x >= bounds.min[0] && record.x <= bounds.max[0] &&
            record.y >= bounds.min[1] && record.y <= bounds.max[1] &&
            record.z >= bounds.min[2] && record.z <= bounds.max[2]
        ) : recordsForSources;

        const images360 = new Images360(viewer);
        const imagePath = params.imagePath || imageryPath;
        let distance = 0;

        for (let i = 0; i < recordsInBounds.length; i++) {
            const current = recordsInBounds[i];
            if (params.imageExtension && !/\.[a-z0-9]+$/i.test(current.filename)) {
                current.filename += params.imageExtension;
            }
            const previous = recordsInBounds[Math.max(0, i - 1)];
            const next = recordsInBounds[Math.min(recordsInBounds.length - 1, i + 1)];
            const currentXY = transform.forward([current.x, current.y]);
            const previousXY = transform.forward([previous.x, previous.y]);
            const nextXY = transform.forward([next.x, next.y]);
            const currentPosition = new THREE.Vector3(...currentXY, current.z);
            const previousPosition = new THREE.Vector3(...previousXY, previous.z);
            const nextPosition = new THREE.Vector3(...nextXY, next.z);

            if (i > 0) {
                distance += currentPosition.distanceTo(previousPosition);
            }

            const trajectoryCourse = calculateBearing(current.x, current.y, next.x, next.y) + 180;
            const course = params.useCsvOrientation && Number.isFinite(current.course) ? current.course : trajectoryCourse;
            const image360 = new Image360(
                `${imagePath}/${current.filename}`,
                current.time,
                current.x,
                current.y,
                current.z,
                course,
                Number.isFinite(current.pitch) ? current.pitch : 0,
                Number.isFinite(current.roll) ? current.roll : 0,
            );

            image360.index = i;
            image360.distance = distance;
            image360.orientationMode = params.useCsvOrientation ? 'absolute' : 'legacy';
            image360.headingOffset = Number(params.headingOffset) || 0;
            image360.pitchOffset = Number(params.pitchOffset) || 0;
            image360.rollOffset = Number(params.rollOffset) || 0;
            const offset = params.positionOffset || [];
            const positionOffset = new THREE.Vector3(
                Number(offset[0]) || 0,
                Number(offset[1]) || 0,
                Number(offset[2]) || 0,
            );
            currentPosition.add(positionOffset);
            previousPosition.add(positionOffset);
            nextPosition.add(positionOffset);
            image360.currentPosition = currentPosition;
            image360.previousPosition = previousPosition;
            image360.nextPosition = nextPosition;
            image360.previousIndex = Math.max(0, i - 1);
            image360.nextIndex = Math.min(recordsInBounds.length - 1, i + 1);
            image360.position = currentPosition.toArray();

            drawNavigationArrows(image360);
            images360.images.push(image360);
        }

        Images360Loader.createSceneNodes(images360, transform);

        return images360;
    }

    static createSceneNodes(images360, transform) {
        for (let image360 of images360.images) {
            let mesh = new THREE.Mesh(sg, sm);
            mesh.scale.set(3, 3, 3);
            mesh.material.transparent = true;
            mesh.material.opacity = 0.75;
            mesh.image360 = image360;

            applyImageTransform(mesh, image360);

            images360.node.add(mesh);

            image360.mesh = mesh;
        }
    }
}
