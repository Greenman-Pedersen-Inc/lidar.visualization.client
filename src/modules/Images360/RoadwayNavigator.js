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
        this.defaultCalibration = options.defaultCalibration || {
            headingOffset: 0,
            pitchOffset: 0,
            rollOffset: 0,
            positionOffset: [0, 0, 0],
        };
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

        const modes = document.createElement('div');
        modes.className = 'potree-roadway-navigator__modes';
        this.externalControls = (options.visibilityControls || [])
            .filter((control) => control)
            .map((control) => ({ control, parent: control.parentElement }));
        for (const { control } of this.externalControls) {
            control.hidden = false;
            modes.appendChild(control);
        }
        modes.appendChild(mode);

        this.alignmentButton = this.createButton('Fine-tune panorama alignment', 'Align');
        this.alignmentButton.className = 'potree-roadway-navigator__align-button';
        this.alignmentButton.setAttribute('aria-expanded', 'false');

        const footer = document.createElement('div');
        footer.className = 'potree-roadway-navigator__footer';
        footer.append(modes, this.alignmentButton);

        this.alignmentPanel = document.createElement('div');
        this.alignmentPanel.className = 'potree-roadway-navigator__alignment';
        this.alignmentPanel.hidden = true;
        this.calibrationInputs = {};
        const calibration = images360.getCalibration();
        const fields = [
            ['headingOffset', 'Heading', -15, 15, 0.1, '°'],
            ['pitchOffset', 'Pitch', -10, 10, 0.1, '°'],
            ['rollOffset', 'Roll', -10, 10, 0.1, '°'],
            ['positionX', 'X', -10, 10, 0.1, ' ft'],
            ['positionY', 'Y', -10, 10, 0.1, ' ft'],
            ['positionZ', 'Z', -10, 10, 0.1, ' ft'],
        ];
        const values = {
            headingOffset: calibration.headingOffset,
            pitchOffset: calibration.pitchOffset,
            rollOffset: calibration.rollOffset,
            positionX: calibration.positionOffset[0],
            positionY: calibration.positionOffset[1],
            positionZ: calibration.positionOffset[2],
        };

        for (const [name, label, min, max, step, unit] of fields) {
            const control = document.createElement('label');
            const caption = document.createElement('span');
            caption.textContent = label;
            const input = document.createElement('input');
            input.type = 'range';
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            input.value = String(values[name] || 0);
            input.setAttribute('aria-label', `${label} panorama calibration`);
            const output = document.createElement('output');
            output.textContent = `${Number(input.value).toFixed(1)}${unit}`;
            input.addEventListener('input', () => {
                output.textContent = `${Number(input.value).toFixed(1)}${unit}`;
                this.applyCalibration();
            });
            this.calibrationInputs[name] = input;
            control.append(caption, input, output);
            this.alignmentPanel.appendChild(control);
        }

        this.resetAlignmentButton = this.createButton('Reset panorama alignment', 'Reset');
        this.resetAlignmentButton.className = 'potree-roadway-navigator__reset-button';
        this.alignmentPanel.appendChild(this.resetAlignmentButton);

        this.element.append(heading, controls, footer, this.alignmentPanel);
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
        this.panoramaInput.addEventListener('change', () => {
            if (!this.panoramaInput.checked && this.images360.focusedImage) {
                this.images360.unfocus({ restoreView: false });
                return;
            }
            this.navigate();
        });
        this.alignmentButton.addEventListener('click', () => {
            this.alignmentPanel.hidden = !this.alignmentPanel.hidden;
            this.alignmentButton.setAttribute('aria-expanded', String(!this.alignmentPanel.hidden));
        });
        this.resetAlignmentButton.addEventListener('click', () => this.resetCalibration());
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

    applyCalibration() {
        const calibration = {
            headingOffset: Number(this.calibrationInputs.headingOffset.value),
            pitchOffset: Number(this.calibrationInputs.pitchOffset.value),
            rollOffset: Number(this.calibrationInputs.rollOffset.value),
            positionOffset: [
                Number(this.calibrationInputs.positionX.value),
                Number(this.calibrationInputs.positionY.value),
                Number(this.calibrationInputs.positionZ.value),
            ],
        };
        this.images360.setCalibration(calibration);

        if (this.options.calibrationStorageKey) {
            try {
                window.localStorage.setItem(this.options.calibrationStorageKey, JSON.stringify(calibration));
            } catch (error) {
                console.warn('Unable to save roadway calibration', error);
            }
        }
    }

    resetCalibration() {
        const calibration = this.defaultCalibration;
        const offset = calibration.positionOffset || [];
        const values = {
            headingOffset: calibration.headingOffset || 0,
            pitchOffset: calibration.pitchOffset || 0,
            rollOffset: calibration.rollOffset || 0,
            positionX: offset[0] || 0,
            positionY: offset[1] || 0,
            positionZ: offset[2] || 0,
        };

        for (const [name, value] of Object.entries(values)) {
            const input = this.calibrationInputs[name];
            input.value = String(value);
            input.dispatchEvent(new Event('input'));
        }
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
        for (const { control, parent } of this.externalControls) {
            control.hidden = true;
            parent.appendChild(control);
        }
        this.element.remove();
    }
}
