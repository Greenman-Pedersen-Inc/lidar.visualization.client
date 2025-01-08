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

        this.sphere = new THREE.Mesh(sgHigh, sm);
        this.sphere.visible = false;
        this.sphere.scale.set(1000, 1000, 1000);
        this.node.add(this.sphere);
        this._visible = true;
        // this.node.add(label);

        this.focusedImage = null;

        let elUnfocus = document.createElement('input');
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

        let elWithdraw = document.createElement('input');
        elWithdraw.type = 'button';
        elWithdraw.value = 'Withdraw';
        elWithdraw.style.position = 'absolute';
        elWithdraw.style.right = '150px';
        elWithdraw.style.bottom = '10px';
        elWithdraw.style.zIndex = '10000';
        elWithdraw.style.fontSize = '2em';
        elWithdraw.addEventListener('click', () => this.advance());
        this.elWithdraw = elWithdraw;

        this.domRoot = viewer.renderer.domElement.parentElement;
        this.domRoot.appendChild(elWithdraw);
        this.elWithdraw.style.display = 'none';

        let elAdvance = document.createElement('input');
        elAdvance.type = 'button';
        elAdvance.value = 'Advance';
        elAdvance.style.position = 'absolute';
        elAdvance.style.right = '300px';
        elAdvance.style.bottom = '10px';
        elAdvance.style.zIndex = '10000';
        elAdvance.style.fontSize = '2em';
        elAdvance.addEventListener('click', () => this.advance());
        this.elAdvance = elAdvance;

        this.domRoot = viewer.renderer.domElement.parentElement;
        this.domRoot.appendChild(elAdvance);
        this.elAdvance.style.display = 'none';

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

    focus(image360) {
        if (this.focusedImage !== null) {
            this.unfocus();
        }

        previousView = {
            controls: this.viewer.controls,
            position: this.viewer.scene.view.position.clone(),
            target: viewer.scene.view.getPivot(),
        };

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

        this.focusedImage = image360;

        this.elUnfocus.style.display = '';
        this.elAdvance.style.display = '';
        this.elWithdraw.style.display = '';
    }

    unfocus() {
        this.selectingEnabled = true;

        for (let image of this.images) {
            image.mesh.visible = true;
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
        this.elAdvance.style.display = 'none';
        this.elWithdraw.style.display = 'none';
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

        //label.visible = true;
        //label.setText(currentlyHovered.image360.file);
        //currentlyHovered.getWorldPosition(label.position);
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
        function toAngle(x) {
            return (x * 180) / Math.PI;
        }
        function toReal(x) {
            if (!isNaN(parseFloat(x)) && isFinite(parseFloat(x))) {
                return parseFloat(parseFloat(x).toFixed(7));
            } else {
                return x;
            }
        }

        if (!params.transform) {
            params.transform = {
                forward: (a) => a,
            };
        }

        let response = await fetch(`${imageryPath}/${imageryDataFile}`);
        let text = await response.text();

        let lines = text.split(/\r?\n/);
        let coordinateLines = lines.slice(1);

        let images360 = new Images360(viewer);
        let previousLine;
        let bearing;

        for (let line of coordinateLines) {
            if (line.trim().length === 0) {
                continue;
            }

            let tokens = line.split(/\t/);

            let [time, filename, long, lat, alt, course, pitch, roll] = tokens;
            time = parseFloat(time);
            long = parseFloat(long);
            lat = parseFloat(lat);
            alt = parseFloat(alt);
            course = parseFloat(course); // Z
            pitch = parseFloat(pitch); // Y
            roll = parseFloat(roll); // X

            // function calculateBearing(latA, lonA, latB, lonB) {
            //     const toRadians = (degrees) => degrees * (Math.PI / 180);
            //     const toDegrees = (radians) => radians * (180 / Math.PI);

            //     const dLat = toRadians(latB - latA);
            //     const dLon = toRadians(lonB - lonA);

            //     let bearing = Math.atan2(
            //         Math.sin(dLon) * Math.cos(toRadians(latB)),
            //         Math.cos(toRadians(latA)) * Math.sin(toRadians(latB)) - Math.sin(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.cos(dLon)
            //     );

            //     bearing = toDegrees(bearing);
            //     return (bearing + 360) % 360; // Normalize the bearing to 0-360 degrees
            // }

            function calculateBearing(E1, N1, E2, N2) {
                const deltaE = E2 - E1;
                const deltaN = N2 - N1;

                const bearingRad = Math.atan2(deltaE, deltaN);
                let bearingDeg = bearingRad * (180 / Math.PI); // Convert radians to degrees

                if (bearingDeg < 0) {
                    bearingDeg += 360; // Normalize the bearing to 0-360 degrees
                }

                // return bearingDeg;
                return bearingRad;
            }

            if (previousLine) {
                let prevTokens = previousLine.split(/\t/);
                let [prevTime, prevFilename, prevLong, prevLat, prevAlt, prevCourse, prevPitch, prevRoll] = prevTokens;

                bearing = calculateBearing(prevLat, prevLong, lat, long);
                // console.log(bearing);
            }
            // attempts to align the photosphere to the lidar
            // this won't work because there is distortion that is not accounted for
            // rot_z = numpy.atan2(math.degrees(z), math.sqrt(-math.degrees(y) - math.degrees(y) + (-math.degrees(x) - math.degrees(x))));
            // rot_y = numpy.arctan2(math.degrees(y), math.degrees(-x));
            // rot_x = math.degrees(x);

            // if (real) {
            //     var quat = new Quaternion(roll, pitch, course, real);

            //     var q = quat;
            //     var m = new Matrix4();
            //     m.makeRotationFromQuaternion(q);

            //     var axis = [0, 0, 0];
            //     var angle = 2 * Math.acos(q.w);
            //     if (1 - q.w * q.w < 0.000001) {
            //         axis[0] = q.x;
            //         axis[1] = q.y;
            //         axis[2] = q.z;
            //     } else {
            //         // http://www.euclideanspace.com/maths/geometry/rotations/conversions/quaternionToAngle/
            //         var s = Math.sqrt(1 - q.w * q.w);
            //         axis[0] = q.x / s;
            //         axis[1] = q.y / s;
            //         axis[2] = q.z / s;
            //     }

            //     var eu = new Euler();
            //     eu.setFromRotationMatrix(m, 'XYZ');

            //     this.roll = toReal(toAngle(eu.toArray()[0]));
            //     this.pitch = toReal(toAngle(eu.toArray()[1]));
            //     this.course = 360 - toReal(toAngle(eu.toArray()[2]));
            // } else {
            //     this.course = course;
            //     this.pitch = pitch;
            //     this.roll = roll;
            // }

            // only load 360 images for the section of lidar loaded
            let min_x = params.metadata.boundingBox.min[0];
            let min_y = params.metadata.boundingBox.min[1];
            let min_z = params.metadata.boundingBox.min[2];
            let max_x = params.metadata.boundingBox.max[0];
            let max_y = params.metadata.boundingBox.max[1];
            let max_z = params.metadata.boundingBox.max[2];

            if (bearing) {
                if (long >= min_x && long <= max_x) {
                    if (lat >= min_y && lat <= max_y) {
                        if (alt >= min_z && alt <= max_z) {
                            filename = filename.replace(/"/g, '');

                            let file = `${imageryPath}/${filename}`;

                            let image360 = new Image360(file, time, long, lat, alt, course, pitch, roll);

                            let xy = params.transform.forward([long, lat]);
                            console.log(long, lat, alt, course);
                            let position = [...xy, alt];
                            image360.position = position;

                            images360.images.push(image360);
                        }
                    }
                }
            }

            previousLine = line;
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
            mesh.scale.set(1, 1, 1);
            // mesh.material.transparent = true;
            // mesh.material.opacity = 0.75;
            mesh.image360 = image360;

            // {
            //     // orientation
            //     var { course, pitch, roll } = image360;
            //     mesh.rotation.set(THREE.Math.degToRad(+roll + 90), THREE.Math.degToRad(-pitch), THREE.Math.degToRad(-course + 90), 'ZYX');
            //     mesh.updateMatrixWorld();

            //     // mesh.rotation.setFromVector3(new THREE.Vector3(Math.PI / 2, 0, 0));
            //     // mesh.rotateX(Math.PI / 2);
            //     // mesh.rotation.set(THREE.Math.degToRad(roll), THREE.Math.degToRad(pitch), THREE.Math.degToRad(course), 'ZYX');
            //     // mesh.quaternion.set(0, 0, 0, pi / 2);
            // }

            images360.node.add(mesh);

            image360.mesh = mesh;
        }
    }
}
