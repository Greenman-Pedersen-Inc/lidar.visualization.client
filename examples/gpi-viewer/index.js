import * as THREE from '../../libs/three.js/build/three.module.js';

let animation;
const baseURL = 'https://gpi-inspections.com/gpi-viewer/data/v1/';
const playButton = document.getElementById('play-button');
const pauseButton = document.getElementById('pause-button');
const closeLidarViewerButton = document.getElementById('close-lidar-viewer-button');

window.viewer = new Potree.Viewer(document.getElementById('potree_render_area'));

viewer.setEDLEnabled(true);
// viewer.setFOV(60);
viewer.setPointBudget(2_000_000);
viewer.loadSettingsFromURL();
viewer.loadGUI(() => {
    $('.potree_menu_toggle').addClass('hidden');
    viewer.setLanguage('en');
    // viewer.setBackground('white');
    viewer.setControls(viewer.earthControls);
    viewer.useHQ = true;
    viewer.setLengthUnit('ft');
    // viewer.toggleSidebar();

    new Toolbar('#measurement-menu');
});

function loadMenu(rootDirectory) {
    return fetch(baseURL + 'run_list')
        .then((response) => response.json())
        .then((data) => {
            $('#route-selector').jstree({
                core: {
                    data: data.tree,
                },
                plugins: ['search'],
            });
            $('#route-selector').on('select_node.jstree', function (e, data) {
                if (data.node.original.path) {
                    loadRoute(data.node.original.path);
                }
            });

            return data.flatList;
        });
}
function loadRouteTest(folderInfo, firstSegment = false) {
    try {
        const metadataPath = `${folderInfo}/metadata.json`;

        Potree.loadPointCloud(metadataPath, folderInfo.split('/').pop().split('.')[0], (e) => {
            let scene = viewer.scene;
            let pointcloud = e.pointcloud;
            let material = pointcloud.material;

            material.pointSizeType = Potree.PointSizeType.ADAPTIVE;
            material.size = 0.6;

            scene.addPointCloud(pointcloud);

            if (firstSegment) positionCamera(metadataPath);
            // createAnimation(parentNodeText, nodeText);
            // loadPhotoPoints(folderInfo.imagery, roadSegment);
        });
    } catch (error) {
        console.log(error);
    } finally {
    }
    // Load and add point cloud to scene
}
function loadRoute(folderPath, roadSegment = '') {
    try {
        const metadataPath = `${folderPath}/metadata.json`;
        const mapContainer = document.getElementById('map-container');
        const potreeContainer = document.getElementById('potree-container');

        mapContainer.classList.add('hidden');
        potreeContainer.classList.remove('hidden');
        Potree.loadPointCloud(metadataPath, roadSegment, (e) => {
            let scene = viewer.scene;
            let pointcloud = e.pointcloud;
            let material = pointcloud.material;

            material.pointSizeType = Potree.PointSizeType.ADAPTIVE;
            material.size = 0.6;
            material.activeAttributeName = 'classification';

            scene.addPointCloud(pointcloud);

            new ClassificationSelector('classification-container');

            positionCamera(metadataPath);
            // createAnimation(parentNodeText, nodeText);
            loadPhotoPoints(folderPath, roadSegment);
        });
    } catch (error) {
        console.log(error);
    } finally {
    }
    // Load and add point cloud to scene
}
async function positionCamera(metadataPath) {
    const metadataRequest = await fetch(metadataPath);
    const metadata = await metadataRequest.json();
    console.log(metadata);

    let centroidX = metadata.boundingBox.min[0] + (metadata.boundingBox.max[0] - metadata.boundingBox.min[0]) / 2;
    let centroidY = metadata.boundingBox.min[1] + (metadata.boundingBox.max[1] - metadata.boundingBox.min[1]) / 2;

    viewer.scene.view.position.set(centroidX, centroidY, metadata.boundingBox.max[2]);
    viewer.scene.view.lookAt(new THREE.Vector3(centroidX, centroidY, metadata.boundingBox.min[2]));
}
function loadPhotoPoints(baseFolder, roadSegment) {
    // this file contains coordinates, orientation and filenames of the images:
    // http://5.9.65.151/mschuetz/potree/resources/pointclouds/helimap/360/Drive2_selection/coordinates.txt

    // "D:\input\00000021_NJ21\360_Imagery\LB5, Camera Ladybug.csv"

    const imageryPath = `${baseFolder}`;

    // the 360 loader loads images from the csv
    Potree.Images360Loader.load(imageryPath, viewer, {}).then((images) => {
        viewer.scene.add360Images(images);
    });
}
async function createAnimation(parentNodeText, nodeText) {
    animation = new Potree.CameraAnimation(viewer);
    animation.duration = 400;

    const positions = [];

    const targets = [];

    for (let i = 0; i < positions.length; i++) {
        if (i % 100 === 0) {
            let position = positions[i];
            let target = targets[i];

            position[2] += 0;
            target[2] += 0;

            const cp = animation.createControlPoint();

            cp.position.set(...position);
            cp.target.set(...target);
        }
    }

    viewer.scene.addCameraAnimation(animation);
    animation.play();
}
function Toolbar(attachPoint) {
    const self = this;

    this.measuringTool = viewer.measuringTool;
    this.createToolIcon = (icon, title, callback) => {
        let element = $(`
        <img src="${icon}"
            style="width: 32px; height: 32px"
            class="button-icon"
            data-i18n="${title}" />
    `);

        element.click(callback);

        return element;
    };

    // ANGLE
    let elToolbar = $(attachPoint);
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/angle.png', '[title]tt.angle_measurement', () => {
            $('#menu_measurements').next().slideDown();
            let measurement = this.measuringTool.startInsertion({
                showDistances: false,
                showAngles: true,
                showArea: false,
                closed: true,
                maxMarkers: 3,
                name: 'Angle',
            });

            let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
            let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === measurement.uuid);
            $.jstree.reference(jsonNode.id).deselect_all();
            $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        })
    );

    // POINT
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/point.svg', '[title]tt.point_measurement', () => {
            $('#menu_measurements').next().slideDown();
            let measurement = this.measuringTool.startInsertion({
                showDistances: false,
                showAngles: false,
                showCoordinates: true,
                showArea: false,
                closed: true,
                maxMarkers: 1,
                name: 'Point',
            });

            let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
            let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === measurement.uuid);
            $.jstree.reference(jsonNode.id).deselect_all();
            $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        })
    );

    // DISTANCE
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/distance.svg', '[title]tt.distance_measurement', () => {
            $('#menu_measurements').next().slideDown();
            let measurement = this.measuringTool.startInsertion({
                showDistances: true,
                showArea: false,
                closed: false,
                name: 'Distance',
            });

            let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
            let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === measurement.uuid);
            $.jstree.reference(jsonNode.id).deselect_all();
            $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        })
    );

    // HEIGHT
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/height.svg', '[title]tt.height_measurement', () => {
            $('#menu_measurements').next().slideDown();
            let measurement = this.measuringTool.startInsertion({
                showDistances: false,
                showHeight: true,
                showArea: false,
                closed: false,
                maxMarkers: 2,
                name: 'Height',
            });

            let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
            let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === measurement.uuid);
            $.jstree.reference(jsonNode.id).deselect_all();
            $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        })
    );

    // CIRCLE
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/circle.svg', '[title]tt.circle_measurement', () => {
            $('#menu_measurements').next().slideDown();
            let measurement = this.measuringTool.startInsertion({
                showDistances: false,
                showHeight: false,
                showArea: false,
                showCircle: true,
                showEdges: false,
                closed: false,
                maxMarkers: 3,
                name: 'Circle',
            });

            let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
            let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === measurement.uuid);
            $.jstree.reference(jsonNode.id).deselect_all();
            $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        })
    );

    // AZIMUTH
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/azimuth.svg', 'Azimuth', () => {
            $('#menu_measurements').next().slideDown();
            let measurement = this.measuringTool.startInsertion({
                showDistances: false,
                showHeight: false,
                showArea: false,
                showCircle: false,
                showEdges: false,
                showAzimuth: true,
                closed: false,
                maxMarkers: 2,
                name: 'Azimuth',
            });

            let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
            let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === measurement.uuid);
            $.jstree.reference(jsonNode.id).deselect_all();
            $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        })
    );

    // AREA
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/area.svg', '[title]tt.area_measurement', () => {
            $('#menu_measurements').next().slideDown();
            let measurement = this.measuringTool.startInsertion({
                showDistances: true,
                showArea: true,
                closed: true,
                name: 'Area',
            });

            let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
            let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === measurement.uuid);
            $.jstree.reference(jsonNode.id).deselect_all();
            $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        })
    );

    // VOLUME
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/volume.svg', '[title]tt.volume_measurement', () => {
            let volume = this.volumeTool.startInsertion();

            let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
            let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === volume.uuid);
            $.jstree.reference(jsonNode.id).deselect_all();
            $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        })
    );

    // SPHERE VOLUME
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/sphere_distances.svg', '[title]tt.volume_measurement', () => {
            let volume = this.volumeTool.startInsertion({ type: SphereVolume });

            let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
            let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === volume.uuid);
            $.jstree.reference(jsonNode.id).deselect_all();
            $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        })
    );

    // PROFILE
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/profile.svg', '[title]tt.height_profile', () => {
            $('#menu_measurements').next().slideDown();
            let profile = this.profileTool.startInsertion();

            let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
            let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === profile.uuid);
            $.jstree.reference(jsonNode.id).deselect_all();
            $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        })
    );

    // ANNOTATION
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/annotation.svg', '[title]tt.annotation', () => {
            $('#menu_measurements').next().slideDown();
            let annotation = viewer.annotationTool.startInsertion();

            let annotationsRoot = $('#jstree_scene').jstree().get_json('annotations');
            let jsonNode = annotationsRoot.children.find((child) => child.data.uuid === annotation.uuid);
            $.jstree.reference(jsonNode.id).deselect_all();
            $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        })
    );

    // REMOVE ALL
    elToolbar.append(
        this.createToolIcon(Potree.resourcePath + '/icons/reset_tools.svg', '[title]tt.remove_all_measurement', () => {
            viewer.scene.removeAllMeasurements();
        })
    );

    {
        // SHOW / HIDE Measurements
        let elShow = $('#measurement_options_show');
        elShow.selectgroup({ title: 'Show/Hide labels' });

        elShow.find('input').click((e) => {
            const show = e.target.value === 'SHOW';
            this.measuringTool.showLabels = show;
        });

        let currentShow = this.measuringTool.showLabels ? 'SHOW' : 'HIDE';
        elShow.find(`input[value=${currentShow}]`).trigger('click');
    }
}
function ClassificationSelector(attachPoint) {
    let elClassificationList = $(`#${attachPoint}`);

    let addClassificationItem = (code, name) => {
        const classification = viewer.classifications[code];
        const inputID = 'chkClassification_' + code;
        const colorPickerID = 'colorPickerClassification_' + code;

        const checked = classification.visible ? 'checked' : '';

        let element = $(`
            <li>
                <label style="whitespace: nowrap; display: flex; align-items: center; margin-bottom: 3px;">
                    <input id="${inputID}" type="checkbox" ${checked}/>
                    <span style="flex-grow: 1">${name}</span>
                    <input id="${colorPickerID}" style="zoom: 0.5" />
                </label>
            </li>
        `);

        const elInput = element.find('input');
        const elColorPicker = element.find(`#${colorPickerID}`);

        elInput.click((event) => {
            viewer.setClassificationVisibility(code, event.target.checked);
        });

        let defaultColor = classification.color.map((c) => c * 255).join(', ');
        defaultColor = `rgb(${defaultColor})`;

        elColorPicker.spectrum({
            // flat: true,
            color: defaultColor,
            showInput: true,
            preferredFormat: 'rgb',
            cancelText: '',
            chooseText: 'Apply',
            move: (color) => {
                let rgb = color.toRgb();
                const c = [rgb.r / 255, rgb.g / 255, rgb.b / 255, 1];
                classification.color = c;
            },
            change: (color) => {
                let rgb = color.toRgb();
                const c = [rgb.r / 255, rgb.g / 255, rgb.b / 255, 1];
                classification.color = c;
            },
        });

        elClassificationList.append(element);
    };

    const addToggleAllButton = () => {
        // toggle all button
        const element = $(`
            <li>
                <label style="whitespace: nowrap">
                    <input id="toggleClassificationFilters" type="checkbox" checked/>
                    <span>show/hide all</span>
                </label>
            </li>
        `);

        let elInput = element.find('input');

        elInput.click((event) => {
            viewer.toggleAllClassificationsVisibility();
        });

        elClassificationList.append(element);
    };

    const addInvertButton = () => {
        const element = $(`
				<li>
					<input type="button" value="invert" />
				</li>
			`);

        let elInput = element.find('input');

        elInput.click(() => {
            const classifications = viewer.classifications;

            for (let key of Object.keys(classifications)) {
                let value = classifications[key];
                viewer.setClassificationVisibility(key, !value.visible);
            }
        });

        elClassificationList.append(element);
    };

    const populate = () => {
        addToggleAllButton();
        for (let classID in viewer.classifications) {
            addClassificationItem(classID, viewer.classifications[classID].name);
        }
        addInvertButton();
    };

    populate();

    viewer.addEventListener('classifications_changed', () => {
        elClassificationList.empty();
        populate();
    });

    viewer.addEventListener('classification_visibility_changed', () => {
        {
            // set checked state of classification buttons
            for (const classID of Object.keys(viewer.classifications)) {
                const classValue = viewer.classifications[classID];

                let elItem = elClassificationList.find(`#chkClassification_${classID}`);
                elItem.prop('checked', classValue.visible);
            }
        }

        {
            // set checked state of toggle button based on state of all other buttons
            let numVisible = 0;
            let numItems = 0;
            for (const key of Object.keys(viewer.classifications)) {
                if (viewer.classifications[key].visible) {
                    numVisible++;
                }
                numItems++;
            }
            const allVisible = numVisible === numItems;

            let elToggle = elClassificationList.find('#toggleClassificationFilters');
            elToggle.prop('checked', allVisible);
        }
    });
}

playButton.addEventListener('click', (event) => {
    viewer.setPointBudget(250_000);
    animation.play();
});
pauseButton.addEventListener('click', (event) => {
    viewer.setPointBudget(10_000_000);
    animation.pause();
});
closeLidarViewerButton.addEventListener('click', (event) => {
    const mapContainer = document.getElementById('map-container');
    const potreeContainer = document.getElementById('potree-container');

    mapContainer.classList.remove('hidden');
    potreeContainer.classList.add('hidden');
});

require(['esri/layers/GeoJSONLayer', 'esri/Map', 'esri/renderers/Renderer', 'esri/views/MapView', 'esri/core/reactiveUtils', 'esri/widgets/Compass', 'esri/widgets/ScaleBar'], (
    GeoJSONLayer,
    Map,
    Renderer,
    MapView,
    reactiveUtils,
    Compass,
    ScaleBar
) => {
    const map = new Map({
        basemap: 'topo-vector',
    });
    const view = new MapView({
        container: 'map-container', // reference to the div id
        map: map,
        zoom: 8,
        center: [-74.4057, 40.0583],
    });
    let compass = new Compass({
        view: view,
    });
    let scaleBar = new ScaleBar({
        view: view,
    });

    view.ui.add(compass, 'bottom-left');
    view.ui.add(scaleBar, 'bottom-right');

    view.when(() => {
        loadMenu().then((flatLidarList) => {
            // flatLidarList
            //     .filter((path) => path.indexOf('80_EB') >= 0)
            //     .forEach((path, index) => {
            //         console.log(path);
            //         loadRouteTest(path, index === 0);
            //     });

            reactiveUtils.on(
                () => view.popup,
                'trigger-action',
                (event) => {
                    if (event.action.id === 'open-route') {
                        const attributes = view.popup.selectedFeature.attributes;

                        const path = flatLidarList.filter((element) => element.indexOf(attributes.NAME) >= 0);

                        if (path.length === 1) {
                            loadRoute(path[0], attributes.NAME);
                        }
                    }
                }
            );
        });

        let renderer = {
            type: 'simple', // autocasts as new SimpleRenderer()
            symbol: {
                type: 'simple-fill', // autocasts as new SimpleFillSymbol()
                color: [255, 128, 0, 0.5],
                outline: {
                    // autocasts as new SimpleLineSymbol()
                    width: 1,
                    color: 'white',
                },
            },
        };

        let openRouteAction = {
            // This text is displayed as a tooltip
            title: 'Open Route',
            // The ID by which to reference the action in the event handler
            id: 'open-route',
            // Sets the icon font used to style the action button
            className: 'esri-icon-zoom-out-magnifying-glass',
        };
        const runCoveragePopupTemplate = {
            title: 'Route Segment {NAME}',
            content: (feature) => {
                console.log(feature);
            },
            actions: [openRouteAction],
        };
        const runCoverage = new GeoJSONLayer({
            url: baseURL + 'run_coverage',
            renderer: renderer,
            fields: [
                {
                    name: 'OBJECTID',
                    alias: 'OBJECTID',
                    type: 'oid',
                },
                {
                    name: 'NAME',
                    alias: 'Route Segment Name',
                    type: 'string',
                },
                {
                    name: 'path',
                    alias: 'path',
                    type: 'string',
                },
            ],
            content: [
                {
                    type: 'fields', // Autocasts as new FieldsContent()
                    // Autocasts as new FieldInfo[]
                    fieldInfos: [
                        {
                            fieldName: 'NAME',
                        },
                        {
                            fieldName: 'path',
                            visible: false,
                        },
                    ],
                },
            ],
            popupTemplate: runCoveragePopupTemplate,
        });

        const stateOutline = new GeoJSONLayer({
            url: 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/NJ_State_Boundary/FeatureServer/3/query?outFields=*&where=1%3D1&f=geojson',
            renderer: {
                type: 'simple', // autocasts as new SimpleRenderer()
                symbol: {
                    type: 'simple-fill',
                    color: [51, 51, 204, 0.2],
                }, // autocasts as new SimpleFillSymbol()
            },
        });
        map.add(stateOutline); // adds the layer to the map
        map.add(runCoverage); // adds the layer to the map
    });

    // });
});
