import * as THREE from '../../../libs/three.js/build/three.module.js';

export class RoadwayNavigator {
    constructor(viewer, images360, options = {}) {
        if (!images360 || images360.images.length === 0) {
            throw new Error('RoadwayNavigator requires at least one 360 image');
        }

        this.viewer = viewer;
        this.images360 = images360;
        this.options = options;
        this.index = 0;
        this.changeTimer = null;
        this.onImageFocus = (event) => this.setIndex(event.image.index, false);

        this.element = document.createElement('section');
        this.element.className = 'potree-roadway-navigator';
        this.element.setAttribute('aria-label', options.title || 'Roadway navigation');

        const heading = document.createElement('div');
        heading.className = 'potree-roadway-navigator__heading';
        this.title = document.createElement('strong');
        this.title.textContent = options.title || 'Roadway imagery';
        this.status = document.createElement('span');
        heading.append(this.title, this.status);

        const controls = document.createElement('div');
        controls.className = 'potree-roadway-navigator__controls';
        this.previousButton = this.createButton('Previous image', '‹');
        this.range = document.createElement('input');
        this.range.type = 'range';
        this.range.min = '0';
        this.range.max = String(images360.images.length - 1);
        this.range.step = '1';
        this.range.value = '0';
        this.range.setAttribute('aria-label', 'Position along roadway');
        this.nextButton = this.createButton('Next image', '›');
        controls.append(this.previousButton, this.range, this.nextButton);

        const mode = document.createElement('label');
        mode.className = 'potree-roadway-navigator__mode';
        this.panoramaInput = document.createElement('input');
        this.panoramaInput.type = 'checkbox';
        this.panoramaInput.checked = options.panorama !== false;
        mode.append(this.panoramaInput, document.createTextNode(' Open 360° imagery'));

        this.element.append(heading, controls, mode);
        const container = options.container || viewer.renderer.domElement.parentElement;
        container.appendChild(this.element);

        this.previousButton.addEventListener('click', () => this.move(-1));
        this.nextButton.addEventListener('click', () => this.move(1));
        this.range.addEventListener('input', () => {
            this.setIndex(Number(this.range.value), false);
            window.clearTimeout(this.changeTimer);
            this.changeTimer = window.setTimeout(() => this.navigate(), 120);
        });
        this.range.addEventListener('change', () => this.navigate());
        this.panoramaInput.addEventListener('change', () => this.navigate());
        images360.addEventListener('focus', this.onImageFocus);

        this.setIndex(options.index || 0, false);
    }

    createButton(label, text) {
        const button = document.createElement('button');
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.textContent = text;
        return button;
    }

    setIndex(index, navigate = true) {
        this.index = Math.max(0, Math.min(this.images360.images.length - 1, Math.round(index)));
        const image = this.images360.images[this.index];
        this.range.value = String(this.index);
        this.previousButton.disabled = this.index === 0;
        this.nextButton.disabled = this.index === this.images360.images.length - 1;

        const distance = Number.isFinite(image.distance) ? Math.round(image.distance).toLocaleString() : '0';
        const filename = image.file.split('/').pop();
        this.status.textContent = `Image ${this.index + 1} of ${this.images360.images.length} · ${distance} ft · ${filename}`;

        if (navigate) {
            this.navigate();
        }
    }

    move(offset) {
        this.setIndex(this.index + offset);
    }

    navigate() {
        window.clearTimeout(this.changeTimer);
        const image = this.images360.images[this.index];

        if (this.panoramaInput.checked) {
            if (this.images360.focusedImage) {
                this.images360.refocus(image);
            } else {
                this.images360.focus(image);
            }
            return;
        }

        if (this.images360.focusedImage) {
            this.images360.unfocus({ restoreView: false });
        }

        const current = new THREE.Vector3(...image.position);
        const neighbor = this.images360.images[image.nextIndex === image.index ? image.previousIndex : image.nextIndex];
        const direction = new THREE.Vector3(...neighbor.position).sub(current).normalize();
        const cameraPosition = current.clone().addScaledVector(direction, -12);
        cameraPosition.z += 8;
        const target = current.clone().addScaledVector(direction, 45);
        target.z += 3;

        this.viewer.setControls(this.viewer.earthControls);
        this.viewer.scene.view.setView(cameraPosition, target, 250);
    }

    setVisible(visible) {
        this.element.hidden = !visible;
        this.images360.visible = visible;
    }

    destroy() {
        window.clearTimeout(this.changeTimer);
        this.images360.removeEventListener('focus', this.onImageFocus);
        this.element.remove();
    }
}
