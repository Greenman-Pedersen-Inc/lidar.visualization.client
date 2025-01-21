import * as THREE from '../../../libs/three.js/build/three.module.js';
import { EventDispatcher } from '../../EventDispatcher.js';
import { TextSprite } from '../../TextSprite.js';

let sg = new THREE.SphereGeometry(1, 8, 8);
let sgHigh = new THREE.SphereGeometry(1, 128, 128);

let sm = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
let smHovered = new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0xff0000 });

let raycaster = new THREE.Raycaster();
let currentlyHovered = null;

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

        let elUnfocus = document.createElement('input');
        elUnfocus.className = 'unfocus-button'
        elUnfocus.type = 'button';
        elUnfocus.value = 'unfocus';
        elUnfocus.style.position = 'absolute';
        elUnfocus.style.right = '10px';
        elUnfocus.style.bottom = '10px';
        elUnfocus.style.zIndex = '10000';
        elUnfocus.style.fontSize = '2em';
        elUnfocus.addEventListener('click', () => this.unfocus());
        this.elUnfocus = elUnfocus;

        this.domRoot = viewer.renderer.domElement.parentElement;
        this.domRoot.appendChild(elUnfocus);
        this.elUnfocus.style.display = 'none';

        viewer.addEventListener('update', () => {
            this.update(viewer);
        });
        viewer.inputHandler.addInputListener(this);

        this.addEventListener('mousedown', () => {
            if (currentlyHovered && currentlyHovered.image360) {
                this.focus(currentlyHovered.image360);
            }
        });
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
        if (this.focusedImage !== null) {
            this.unfocus();
        }

        if (!refocus) {
            previousView = {
                controls: this.viewer.controls,
                position: this.viewer.scene.view.position.clone(),
                target: viewer.scene.view.getPivot(),
            };
        }

        this.viewer.setControls(this.viewer.orbitControls);
        this.viewer.orbitControls.doubleClockZoomEnabled = false;

        for (let image of this.images) {
            image.mesh.visible = false;
        }

        this.selectingEnabled = false;

        this.sphere.visible = false;

        this.load(image360).then(() => {
            this.sphere.visible = true;
            this.sphere.material.map = image360.texture;
            this.sphere.material.needsUpdate = true;

            if (this.node.children.map((object) => object.uuid).indexOf(image360.forwardArrow.uuid) >= 0) {
                image360.forwardArrow.visible = true;
            } else {
                this.node.add(image360.forwardArrow);
                image360.forwardArrow.visible = true;
            }
            if (this.node.children.map((object) => object.uuid).indexOf(image360.backwardArrow.uuid) >= 0) {
                image360.backwardArrow.visible = true;
            } else {
                this.node.add(image360.backwardArrow);
                image360.backwardArrow.visible = true;
            }
        });

        {
            // orientation
            let { course, pitch, roll } = image360;
            this.sphere.rotation.set(THREE.Math.degToRad(+roll + 90), THREE.Math.degToRad(-pitch), THREE.Math.degToRad(-course + 90), 'ZYX');
        }

        this.sphere.position.set(...image360.position);

        let target = new THREE.Vector3(...image360.position);
        let dir = target.clone().sub(viewer.scene.view.position).normalize();
        let move = dir.multiplyScalar(0.000001);
        let newCamPos = target.clone().sub(move);

        viewer.scene.view.setView(newCamPos, target, 500);
        window.addEventListener('click', this.arrowHoverIntersect);

        this.focusedImage = image360;

        this.elUnfocus.style.display = '';
    }

    arrowHoverIntersect(event) {
        let images360 = viewer.scene.images360[0];
        let mouse = viewer.inputHandler.mouse;
        let camera = viewer.scene.getActiveCamera();
        let domElement = viewer.renderer.domElement;

        let ray = Potree.Utils.mouseToRay(mouse, camera, domElement.clientWidth, domElement.clientHeight);

        // let tStart = performance.now();
        raycaster.ray.copy(ray);

        let intersections = raycaster.intersectObjects(images360.node.children);

        if (intersections.length === 0) {
            // label.visible = false;

            return;
        } else if (intersections.length > 1) {
            let sphere = intersections[0];
            let arrow = intersections[1];

            try {
                if (arrow.object.uuid === sphere.object.image360.forwardArrow.uuid) {
                    let nextImage = images360.images.map((image) => image.file).findIndex((item) => item.includes(sphere.object.image360.nextPosition.nextFilename));
                    images360.refocus(images360.images[nextImage]);
                } else if (arrow.object.uuid === sphere.object.image360.backwardArrow.uuid) {
                    let previousImage = images360.images.map((image) => image.file).findIndex((item) => item.includes(sphere.object.image360.previousPosition.previousFilename));
                    images360.refocus(images360.images[previousImage]);
                }
            } catch (error) {}
        }
    }

    refocus(image360) {
        this.unfocus();
        this.focus(image360, true);
    }

    unfocus() {
        window.removeEventListener('click', this.arrowHoverIntersect);

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

        let pos = viewer.scene.view.position;
        let target = viewer.scene.view.getPivot();
        let dir = target.clone().sub(pos).normalize();
        let move = dir.multiplyScalar(10);
        let newCamPos = target.clone().sub(move);

        viewer.orbitControls.doubleClockZoomEnabled = true;
        viewer.setControls(previousView.controls);

        viewer.scene.view.setView(previousView.position, previousView.target, 500);

        this.focusedImage = null;

        this.elUnfocus.style.display = 'none';
    }

    load(image360) {
        return new Promise((resolve) => {
            let texture = new THREE.TextureLoader().load(image360.file, resolve);
            texture.wrapS = THREE.RepeatWrapping;
            texture.repeat.x = -1;

            image360.texture = texture;
        });
    }

    handleHovering() {
        let mouse = viewer.inputHandler.mouse;
        let camera = viewer.scene.getActiveCamera();
        let domElement = viewer.renderer.domElement;

        let ray = Potree.Utils.mouseToRay(mouse, camera, domElement.clientWidth, domElement.clientHeight);

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
        function drawNavigationArrow(initialPosition, finalPosition) {
            let newInintialPosition = initialPosition.clone();
            let newFinalPosition = finalPosition.clone();

            newInintialPosition.z -= 2.5;
            newFinalPosition.z -= 2.5;

            let dir = newFinalPosition.sub(initialPosition).normalize().multiplyScalar(5);
            let intermediatePoint = newInintialPosition.add(dir);

            let radius = 0.5;
            let h = 3.5;
            let g = new THREE.ConeGeometry(radius, h, 50);
            g.translate(0, h * 0.5, 0); // base to 0
            g.rotateX(Math.PI * 0.5); // align along Z-axis
            let m = new THREE.MeshBasicMaterial(); // or any other material
            let o = new THREE.Mesh(g, m);
            m.transparent = true;
            m.opacity = 0.75;

            o.position.copy(intermediatePoint);
            o.lookAt(finalPosition);

            return o;
        }
        function drawNavigationArrows(image360) {
            let forwardArrow = drawNavigationArrow(image360.currentPosition, image360.nextPosition);
            let backwardArrow = drawNavigationArrow(image360.currentPosition, image360.previousPosition);

            image360.forwardArrow = forwardArrow;
            image360.backwardArrow = backwardArrow;
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
            // return bearingRad;
        }

        if (!params.transform) {
            params.transform = {
                forward: (a) => a,
            };
        }

        let previousLine;
        let bearing;
        let images360 = new Images360(viewer);
        let response = await fetch(`${imageryPath}/${imageryDataFile}`);
        // let response = await fetch(`${url}/coordinates.txt`);
        let text = await response.text();

        // create an array of lines with the return character splitting them
        let lines = text.split(/\r?\n/);
        // remove the header
        let coordinateLines = lines.slice(1);

        // only load 360 images for the section of lidar loaded
        let min_x = params.metadata.boundingBox.min[0];
        let min_y = params.metadata.boundingBox.min[1];
        let min_z = params.metadata.boundingBox.min[2];
        let max_x = params.metadata.boundingBox.max[0];
        let max_y = params.metadata.boundingBox.max[1];
        let max_z = params.metadata.boundingBox.max[2];
        for (var i = 1; i < lines.length - 1; i++) {
            let current = lines[i];

            let tokens = current.split(/\t/);

            let [filename, time, long, lat, alt, course, pitch, roll] = tokens;
            time = parseFloat(time);
            long = parseFloat(long);
            lat = parseFloat(lat);
            alt = parseFloat(alt);
            course = parseFloat(course);
            pitch = parseFloat(pitch);
            roll = parseFloat(roll);

            if (long >= min_x && long <= max_x) {
                if (lat >= min_y && lat <= max_y) {
                    if (alt >= min_z && alt <= max_z) {
                        // get preceeding and following lines if the lines is in extent
                        let previous = lines[i - 1];
                        let previousTokens = previous.split(/\t/);
                        let [previousFilename, previousTime, previousLong, previousLat, previousAlt, previousCourse, previousPitch, previousRoll] = previousTokens;
                        let previousBearing = calculateBearing(long, lat, previousLong, previousLat) + 180;

                        let next = lines[i + 1];
                        let nextTokens = next.split(/\t/);
                        let [nextFilename, nextTime, nextLong, nextLat, nextAlt, nextCourse, nextPitch, nextRoll] = nextTokens;
                        let nextBearing = calculateBearing(long, lat, nextLong, nextLat) + 180;

                        let currentPosition = new THREE.Vector3(long, lat, alt);
                        let previousPosition = new THREE.Vector3(parseFloat(previousLong), parseFloat(previousLat), parseFloat(previousAlt));
                        let nextPosition = new THREE.Vector3(parseFloat(nextLong), parseFloat(nextLat), parseFloat(nextAlt));

                        previousPosition.previousFilename = previousFilename;
                        nextPosition.nextFilename = nextFilename;

                        filename = filename.replace(/"/g, '');

                        let file = `${imageryPath}/${filename}`;

                        let image360 = new Image360(file, time, long, lat, alt, nextBearing, pitch, roll);

                        let xy = params.transform.forward([long, lat]);
                        let position = [...xy, alt];
                        image360.currentPosition = currentPosition;
                        image360.previousPosition = previousPosition;
                        image360.nextPosition = nextPosition;

                        drawNavigationArrows(image360);

                        image360.position = position;

                        images360.images.push(image360);
                    }
                }
            }
        }

        Images360Loader.createSceneNodes(images360, params.transform);

        return images360;
    }

    static createSceneNodes(images360, transform) {
        for (let image360 of images360.images) {
            let { longitude, latitude, altitude } = image360;
            let xy = transform.forward([longitude, latitude]);

            let mesh = new THREE.Mesh(sg, sm);
            mesh.position.set(...xy, altitude);
            mesh.scale.set(3, 3, 3);
            mesh.material.transparent = true;
            mesh.material.opacity = 0.75;
            mesh.image360 = image360;

            {
                // orientation
                var { course, pitch, roll } = image360;
                mesh.rotation.set(THREE.Math.degToRad(+roll + 90), THREE.Math.degToRad(-pitch), THREE.Math.degToRad(-course + 90), 'ZYX');
            }

            images360.node.add(mesh);

            image360.mesh = mesh;
        }
    }
}
