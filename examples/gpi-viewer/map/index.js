import * as THREE from '../libs/three.js/build/three.module.js';
// import * as THREE from '../../../libs/three.js/build/three.module.js';

require([
    'esri/layers/FeatureLayer',
    'esri/layers/GeoJSONLayer',
    'esri/Map',
    'esri/views/MapView',
    'esri/core/reactiveUtils',
    'esri/widgets/Compass',
    'esri/widgets/Legend',
    'esri/widgets/ScaleBar',
    'esri/widgets/BasemapToggle',
    'esri/layers/support/Field',
    'esri/widgets/FeatureTable',
    'esri/geometry/projection',
    'esri/geometry/SpatialReference',
], (FeatureLayer, GeoJSONLayer, Map, MapView, reactiveUtils, Compass, Legend, ScaleBar, BasemapToggle, Field, FeatureTable, projection, SpatialReference) => {
    let animation;
    let classificationSelector;
    // const baseURL = 'http://127.0.0.1:65000/v1/';
    const baseURL = 'https://maps.gpinet.com/gpi-viewer/data/v1/';
    const featureServerURL = 'https://services1.arcgis.com/VLhaRwzp3uCQMr7y/arcgis/rest/services/njx_2300678/FeatureServer/';
    // const playButton = document.getElementById('play-button');
    // const pauseButton = document.getElementById('pause-button');
    const closeLidarViewerButton = document.getElementById('close-lidar-viewer-button');
    const CRED = 'cred_location_storage';
    const credentials = JSON.parse(window.localStorage.getItem(CRED));

    const map = new Map({
        basemap: 'topo-vector',
    });
    const view = new MapView({
        container: 'map-container', // reference to the div id
        map: map,
        zoom: 8,
        center: [-74.4057, 40.0583],
        // center: [-74.75939269860886, 40.20282385900586],
    });
    const scaleBar = new ScaleBar({
        view: view,
        unit: 'imperial',
    });
    const basemapToggle = new BasemapToggle({
        view: view, // The view that provides access to the map's "streets-vector" basemap
        nextBasemap: 'hybrid', // Allows for toggling to the "hybrid" basemap
    });
    const legend = new Legend({
        view: view,
    });

    function loadMenu(credentials) {
        if (credentials && credentials.token) {
            return fetch(baseURL + 'run_list', {
                method: 'GET', // or POST, PUT, DELETE, etc.
                cache: 'no-store',
                headers: {
                    token: credentials.token,
                },
            })
                .then((response) => {
                    if (response.ok) {
                        return response.json();
                    } else {
                        if (response.status === 401) {
                            window.location = '../login';
                        } else {
                            throw 'Failed to fetch data from the server. Please try refreshing the page.';
                        }
                    }
                })
                .then((data) => {
                    $('#route-selector').jstree({
                        core: {
                            data: data.tree.children,
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
        } else {
            window.location = '../login';
        }
    }
    // this function is for adding 3D polygons
    function createMeshFeatures(features) {
        let meshFeatures = [];

        features.forEach((feature) => {
            const coordinates = feature.geometry.coordinates
                .map((nested) =>
                    nested.map((coord) => {
                        return { x: coord[0], y: coord[1], elevation: coord[2] };
                    })
                )
                .flat();
            const polygonShape = new THREE.Shape(coordinates.map((coord) => new THREE.Vector3(coord.x, coord.y, coord.elevation)));
            const polygonGeometry = new THREE.ShapeGeometry(polygonShape);
            const updatedPolygonGeometry = updateShapeGeometryPosition(polygonGeometry, coordinates);
            const polygon = new THREE.Mesh(
                updatedPolygonGeometry,
                new THREE.MeshBasicMaterial({
                    color: 'red',
                    side: THREE.DoubleSide,
                    wireframe: true,
                    vertexColors: true,
                })
            );

            polygon.properties = feature.properties;

            meshFeatures.push(polygon);
        });

        return meshFeatures;
    }
    // load shape files from API
    // async function loadShapeFiles(route) {
    //     const routeShapeFiles = await fetch(`${baseURL}shape_files/${route}`);

    //     for (let i = 0; i < routeShapeFiles.length; i++) {
    //         const loader = new Potree.ShapefileLoader();
    //         const shapeNode = new THREE.Object3D();
    //         const shapeFile = await loader.load(path);
    //         const meshFeatures = createMeshFeatures(shapeFile.features);

    //         viewer.scene.scene.add(shapeNode);
    //         meshFeatures.forEach((meshFeature) => shapeNode.add(meshFeature));
    //     }
    // }
    // load static shape file from file system
    async function loadShapeFiles() {
        try {
            const path = 'GIS/00000080/Rockslope.shp';
            const loader = new Potree.ShapefileLoader();
            const shapeNode = new THREE.Object3D();
            const shapeFile = await loader.load(path);
            shapeNode.add(shapeFile.node);

            // const meshFeatures = createMeshFeatures(shapeFile.features);
            // meshFeatures.forEach((meshFeature) => shapeNode.add(meshFeature));

            viewer.scene.scene.add(shapeNode);
        } catch (error) {
            console.log(error);
        }
    }
    async function loadRoute(folderPath, roadSegment = '', coordinates) {
        try {
            const metadataPath = `${folderPath}/metadata.json`;

            // let remoteAddress = 'https://gpi-inspections.com/gpi-viewer/';
            // const metadataRequest = await fetch(remoteAddress + metadataPath);

            const metadataRequest = await fetch(metadataPath);

            const metadata = await metadataRequest.json();
            const route = metadata.name.split('_')[0];
            const mapContainer = document.getElementById('map-container');
            const potreeContainer = document.getElementById('potree-container');
            const featureTabContainer = document.querySelector('.feature-tab-container');

            featureTabContainer.classList.add('hidden');
            mapContainer.classList.add('hidden');
            potreeContainer.classList.remove('hidden');
            // always position the camera when loading a route (whether previously loaded or not)
            if (coordinates) {
                positionCamera(metadata, coordinates);
            } else {
                positionCamera(metadata);
            }

            if (viewer.scene.pointclouds.map((pointCloud) => pointCloud.name).indexOf(metadata.name) < 0) {
                Potree.loadPointCloud(metadataPath, metadata.name, async (e) => {
                    let scene = viewer.scene;
                    let pointcloud = e.pointcloud;
                    let material = pointcloud.material;

                    material.pointSizeType = Potree.PointSizeType.ADAPTIVE;
                    material.size = 0.6;
                    material.activeAttributeName = 'classification';

                    if (!classificationSelector) {
                        classificationSelector = new ClassificationSelector('classification-container');
                    }

                    // createAnimation(parentNodeText, nodeText);
                    // loadPhotoPoints(folderPath, roadSegment, metadata);
                    // loadShapeFiles();
                    scene.addPointCloud(pointcloud);
                });
            }
        } catch (error) {
            console.log(error);
        } finally {
        }
        // Load and add point cloud to scene
    }
    function positionCamera(metadata, coordinates) {
        let centroidX, centroidY, centroidZ;

        if (coordinates) {
            centroidX = coordinates.x;
            centroidY = coordinates.y;
            centroidZ = coordinates.z;
        } else {
            centroidX = metadata.boundingBox.min[0] + (metadata.boundingBox.max[0] - metadata.boundingBox.min[0]) / 2;
            centroidY = metadata.boundingBox.min[1] + (metadata.boundingBox.max[1] - metadata.boundingBox.min[1]) / 2;
            centroidZ = coordinates.z;
        }

        viewer.scene.view.position.set(centroidX, centroidY, centroidZ);
        viewer.scene.view.lookAt(new THREE.Vector3(centroidX, centroidY, metadata.boundingBox.min[2]));

        return metadata;
    }
    function loadPhotoPoints(baseFolder, roadSegment, parsedMetadata) {
        // this file contains coordinates, orientation and filenames of the images:
        // http://5.9.65.151/mschuetz/potree/resources/pointclouds/helimap/360/Drive2_selection/coordinates.txt

        // "D:\input\00000021_NJ21\360_Imagery\LB5, Camera Ladybug.csv"

        const imagery360Path = `${baseFolder}`;
        let imagery360DataFile = 'coordinates.txt';

        // the 360 loader loads images from the csv
        Potree.Images360Loader.load(imagery360Path, imagery360DataFile, viewer, {
            metadata: parsedMetadata,
        }).then((images) => {
            viewer.scene.add360Images(images);
        });
    }
    function Toolbar(attachPoint) {
        const self = this;

        this.measuringTool = viewer.measuringTool;
        this.createToolIcon = (icon, title, tooltip, callback, id) => {
            let element = $(`
                <img ${id ? `id = "${id}"` : ''} 
                    src="${icon}"
                    style="width: 32px; height: 32px"
                    class="button-icon"
                    title="${tooltip}"
                    data-i18n="${title}" />
            `);

            element.click(callback);

            return element;
        };

        // ANGLE
        let elToolbar = $(attachPoint);
        elToolbar.append(
            this.createToolIcon(Potree.resourcePath + '/icons/angle.png', '[title]tt.angle_measurement', 'Angle Measurement', () => {
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
            this.createToolIcon(Potree.resourcePath + '/icons/point.svg', '[title]tt.point_measurement', 'Point Measurement', () => {
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
            this.createToolIcon(Potree.resourcePath + '/icons/distance.svg', '[title]tt.distance_measurement', 'Distance Measurement', () => {
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
            this.createToolIcon(Potree.resourcePath + '/icons/height.svg', '[title]tt.height_measurement', 'Height Measurement', () => {
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
            this.createToolIcon(Potree.resourcePath + '/icons/circle.svg', '[title]tt.circle_measurement', 'Circle Measurement', () => {
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
            this.createToolIcon(Potree.resourcePath + '/icons/azimuth.svg', 'Azimuth', 'Azimuth', () => {
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
            this.createToolIcon(Potree.resourcePath + '/icons/area.svg', '[title]tt.area_measurement', 'Area Measurement', () => {
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

        // // VOLUME
        // elToolbar.append(
        //     this.createToolIcon(Potree.resourcePath + '/icons/volume.svg', '[title]tt.volume_measurement', () => {
        //         let volume = this.volumeTool.startInsertion();

        //         let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
        //         let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === volume.uuid);
        //         $.jstree.reference(jsonNode.id).deselect_all();
        //         $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        //     })
        // );

        // // SPHERE VOLUME
        // elToolbar.append(
        //     this.createToolIcon(Potree.resourcePath + '/icons/sphere_distances.svg', '[title]tt.volume_measurement', () => {
        //         let volume = this.volumeTool.startInsertion({
        //             type: SphereVolume,
        //         });

        //         let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
        //         let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === volume.uuid);
        //         $.jstree.reference(jsonNode.id).deselect_all();
        //         $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        //     })
        // );

        // PROFILE
        elToolbar.append(
            this.createToolIcon(Potree.resourcePath + '/icons/profile.svg', '[title]tt.height_profile', 'Height Profile', () => {
                $('#menu_measurements').next().slideDown();
                let profile = viewer.profileTool.startInsertion();

                let measurementsRoot = $('#jstree_scene').jstree().get_json('measurements');
                let jsonNode = measurementsRoot.children.find((child) => child.data.uuid === profile.uuid);
                $.jstree.reference(jsonNode.id).deselect_all();
                $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
            })
        );

        // View Profile
        elToolbar.append(
            this.createToolIcon(Potree.resourcePath + '/icons/eye.svg', '[title]tt.view_selected_profile', 'View Selected Profile', () => {
                let show2DProfileIcon = document.getElementById('show_2d_profile');
                show2DProfileIcon.click();
            })
        );

        // // ANNOTATION
        // elToolbar.append(
        //     this.createToolIcon(Potree.resourcePath + '/icons/annotation.svg', '[title]tt.annotation', () => {
        //         $('#menu_measurements').next().slideDown();
        //         let annotation = viewer.annotationTool.startInsertion();

        //         let annotationsRoot = $('#jstree_scene').jstree().get_json('annotations');
        //         let jsonNode = annotationsRoot.children.find((child) => child.data.uuid === annotation.uuid);
        //         $.jstree.reference(jsonNode.id).deselect_all();
        //         $.jstree.reference(jsonNode.id).select_node(jsonNode.id);
        //     })
        // );

        // REMOVE ALL
        elToolbar.append(
            this.createToolIcon(Potree.resourcePath + '/icons/reset_tools.svg', '[title]tt.remove_all_measurement', 'Remove All Measurements', () => {
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
					<input type="button" class="invert" value="Invert" />
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
    function AssetFilter(view, assetType, featureLayer, defaultValues = [], index = -1) {
        function FilterRow(parent, featureLayer, fieldSelected, operatorSelected, valueSelected) {
            const self = this;
            const fieldInfo = featureLayer.fields.filter((field) => field.name === fieldSelected)[0];
            const fieldSelector = new FieldSelector(this, featureLayer.fields, fieldInfo);
            const operatorSelector = new OperatorSelector(this, fieldSelected, operatorSelected);
            const assetValueSelector = new FieldValueSelector(this, fieldInfo, valueSelected);
            const rowClear = document.createElement('calcite-button');

            this._field = fieldInfo;
            this._operator = operatorSelected;
            this._fieldValue = valueSelected;

            Object.defineProperty(this, 'field', {
                get: function () {
                    return self._field;
                },
                set: function (value) {
                    self._field = value;

                    operatorSelector.populate(value);
                    assetValueSelector.populate(value);

                    if (!self.domNode.nextSibling) {
                        parent.addFilterRow(featureLayer);
                    }

                    parent.createQueryString();
                },
                enumerable: false,
            });

            Object.defineProperty(this, 'operator', {
                get: function () {
                    return self._operator;
                },
                set: function (value) {
                    self._operator = value;
                    if (self._fieldValue) {
                        parent.createQueryString();
                    }
                },
                enumerable: false,
            });

            Object.defineProperty(this, 'fieldValue', {
                get: function () {
                    return self._fieldValue;
                },
                set: function (value) {
                    self._fieldValue = value;
                    parent.createQueryString();
                },
                enumerable: false,
            });

            rowClear.innerHTML = 'X';
            rowClear.addEventListener('click', function () {
                parent.removeFilterRow(self);
            });

            this.domNode = document.createElement('div');
            this.domNode.className = 'attribute-row';
            this.domNode.append(fieldSelector.domNode, operatorSelector.domNode, assetValueSelector.domNode, rowClear);
        }
        function FieldSelector(parent, options, fieldSelected) {
            const self = this;

            this.domNode = document.createElement('calcite-select');

            const defaultOption = document.createElement('calcite-option');
            defaultOption.className = 'attribute-selector';

            defaultOption.value = 'Select Field';
            defaultOption.label = 'Select Field';
            defaultOption.setAttribute('id', 'default-option');
            // assetTypeSelector.append(defaultOption);
            this.domNode.append(defaultOption);

            this.clear = function () {
                self.domNode.innerHTML = '';
            };

            this.populate = function (options, fieldSelected) {
                const fieldsToIgnore = [
                    'OBJECTID',
                    'OBJECTID_1',
                    'GlobalID',
                    'GlobalID_2',
                    'SHAPE.STLength()',
                    'Guiderail_Old_GlobalID',
                    'Original_Leading_GlobalID',
                    'Original_GR_GlobalID',
                    'Original_Trailing_GlobalID',
                    'Fixed Object Comments', //fo_comm
                    'General Comments', //notes
                    'Created Date', //created_date
                    'CreationDate', //creationdate
                    'Created User', //created_user
                    'EditDate',
                    'Editor',
                    'Notes from Office Staff',
                    'Inventory Date', //Inventory_Date
                    'Inventory Initials', //Inventory_Initials
                    'Field QC',
                    'Final QC',
                    'Field QC Date',
                    'Final QC Date',
                    'Crash History',
                    'Trailing End Comments', //'Trailing_end_comments',
                    'Leading or Trailing?', //'Leading_l_or_t',
                    'Leading End Comments', //'Leading_end_comments',
                    'GlobalID',
                    'Creator',
                    'created_date',
                    'Inventory Initials',
                    'Inventory Date',
                    'Leading and Trailing Office Notes',
                    'Last Updated Date',
                    'Created User',
                    'Created Date',
                    ' Inventory Initials',
                    'Inventory Date',
                    'Leading and Trailing Office Notes',
                    'Last Edited User',
                    'Last Updated Date',
                    'Creator',
                    'Leading and Trailing General Comments',
                    'Fatality Crashes Last 10 Yrs',
                ];

                options
                    .filter((option) => !fieldsToIgnore.includes(option.alias) && option.alias !== '')
                    .sort((a, b) => a.alias.localeCompare(b.alias))
                    .forEach((option) => {
                        let fieldOption = document.createElement('calcite-option');

                        fieldOption.value = option.name;
                        fieldOption.label = option.alias;

                        if (fieldSelected && option.name === fieldSelected.name) {
                            fieldOption.setAttribute('selected', true);
                        }

                        self.domNode.append(fieldOption);
                    });

                self.domNode.addEventListener('calciteSelectChange', function (event) {
                    self.value = event.target.value;

                    let field = options.filter((field) => field.name === event.target.value)[0];

                    parent.field = field;
                });
            };

            if (options) this.populate(options, fieldSelected);
        }
        function OperatorSelector(parent, fieldSelected, operatorSelected) {
            const self = this;

            Object.defineProperty(this, 'operator', {
                get: function () {
                    return self._operator;
                },
                set: function (value) {
                    self._operator = value;
                    parent.operator = value;
                },
                enumerable: false,
            });

            this.domNode = document.createElement('div');
            this.clear = function () {
                self.domNode.innerHTML = '';
            };

            this.populate = function (fieldSelected, operatorSelected) {
                let operatorTypes = [];
                let operatorSelector = document.createElement('calcite-select');
                operatorSelector.className = 'operator-selector';

                let nameTypeSelector = document.createElement('calcite-input');
                let dateTypeSelector = document.createElement('calcite-input');

                if (
                    fieldSelected.name === 'Cost' ||
                    fieldSelected.name === 'FatalityCrashesLast10Yrs' ||
                    fieldSelected.name === 'fo_dist' ||
                    fieldSelected.name === 'Number_of_Lanes' ||
                    fieldSelected.name === 'ofst_otw' ||
                    fieldSelected.name === 'ofst_atw' ||
                    fieldSelected.name === 'ofst_atw' ||
                    fieldSelected.name === 'AADT_Year' ||
                    fieldSelected.name === 'road_speed' ||
                    fieldSelected.name == 'Milepost' ||
                    fieldSelected.name == 'num_dam_sec' ||
                    fieldSelected.name == 'broken_posts'
                ) {
                    operatorTypes = ['=', '>', '>=', '<', '<=', '<>'];
                } else if (fieldSelected.name === 'aadt') {
                    operatorTypes = ['=', '<>'];
                } else if (fieldSelected.type === 'string') {
                    operatorTypes = ['=', '<>'];
                } else if (fieldSelected.type === 'integer') {
                    operatorTypes = ['=', '>', '>=', '<', '<=', '<>'];
                    nameTypeSelector.setAttribute('type', 'number');
                } else if (fieldSelected.type === 'date') {
                    operatorTypes = ['=', '>', '>=', '<', '<=', '<>'];
                    dateTypeSelector.setAttribute('type', 'date');
                    // alert('date ');
                } else {
                    operatorTypes = ['=', '>', '>=', '<', '<=', '<>'];
                    nameTypeSelector.setAttribute('type', 'string');
                }

                self.domNode.addEventListener('calciteSelectChange', function (event) {
                    self.operator = event.target.value;
                });

                operatorTypes.forEach((option) => {
                    let operatorOption = document.createElement('calcite-option');
                    operatorOption.value = option;
                    operatorOption.label = option;
                    operatorOption.innerHTML = option;
                    operatorSelector.append(operatorOption);

                    if (option === operatorSelected) {
                        operatorOption.setAttribute('selected', true);
                    }
                });

                if (!operatorSelected) {
                    self.operator = operatorTypes[0];
                }

                self.clear();
                self.domNode.append(operatorSelector);
            };

            if (fieldSelected) {
                self.populate(fieldSelected, operatorSelected);
            }
        }
        function FieldValueSelector(parent, fieldSelected, valueSelected) {
            const self = this;
            this.domNode = document.createElement('div');
            this.domNode.className = 'field-option-selector';

            Object.defineProperty(this, 'fieldValue', {
                get: function () {
                    return self._fieldValue;
                },
                set: function (value) {
                    self._fieldValue = value;
                    parent.fieldValue = value;
                },
                enumerable: false,
            });

            this.clear = function () {
                self.domNode.innerHTML = '';
            };

            this.populate = function (field, valueSelected) {
                self.domNode.innerHTML = '';
                self.fieldValue = undefined;

                if (field.domain) {
                    // let comboBox = document.createElement('calcite-select');
                    let comboBox = document.createElement('calcite-combobox');

                    comboBox.className = 'field-value-selector';
                    comboBox.setAttribute('selection-mode', 'single');
                    comboBox.setAttribute('scale', 'm');
                    comboBox.setAttribute('clear-disabled', '');

                    // comboBox.className = 'field-value';

                    // let defaultOption = document.createElement('calcite-option');
                    let defaultOption = document.createElement('calcite-combobox-item');

                    defaultOption.value = 'Pick an option';
                    // defaultOption.label = 'Pick an option';
                    defaultOption.setAttribute('text-label', 'Pick an option');
                    defaultOption.setAttribute('text-label', 'Pick an option');
                    comboBox.append(defaultOption);

                    field.domain.codedValues.forEach((element) => {
                        // let option = document.createElement('calcite-option');
                        let option = document.createElement('calcite-combobox-item');
                        option.value = element.code;
                        // option.label = element.name;
                        option.setAttribute('text-label', element.name);
                        option.className = 'name-value-selector';
                        option.innerHTML = element.name;

                        comboBox.append(option);

                        if (element.code === valueSelected) {
                            option.setAttribute('selected', true);
                        }
                    });
                    this.domNode.append(comboBox);
                } else if (field.name == 'AADT_Year') {
                    const inputElement = document.createElement('calcite-input');
                    inputElement.setAttribute('type', 'number');
                    inputElement.setAttribute('number-button-type', 'none');
                    inputElement.setAttribute('max-length', '4');
                    inputElement.setAttribute('max', '4');
                    inputElement.setAttribute('min-length', '4');
                    inputElement.setAttribute('min', '4');
                    this.domNode.append(inputElement);
                } else if (field.name == 'Shape__Length') {
                    const inputElement = document.createElement('calcite-input');
                    inputElement.setAttribute('type', 'number');
                    inputElement.setAttribute('number-button-type', 'none');
                    this.domNode.append(inputElement);
                } else if (field.type === 'string') {
                    // window.alert('string!');
                    this.domNode.append(document.createElement('calcite-input'));
                } else if (field.type === 'integer') {
                    const inputElement = document.createElement('calcite-input');
                    inputElement.setAttribute('type', 'number');
                    inputElement.setAttribute('number-button-type', 'none');
                    this.domNode.append(inputElement);
                } else if (field.type === 'double') {
                    const inputElement = document.createElement('calcite-input');
                    inputElement.setAttribute('type', 'number');
                    inputElement.setAttribute('number-button-type', 'none');
                    this.domNode.append(inputElement);
                } else if (field.type === 'date') {
                    let dateInput = document.createElement('calcite-input');
                    dateInput.setAttribute('type', 'date');
                    this.domNode.append(dateInput);
                } else {
                    this.domNode.append(document.createElement('calcite-input'));
                }
            };

            this.domNode.addEventListener('calciteComboboxChange', function (event) {
                self.fieldValue = event.target.value;
            });

            this.domNode.addEventListener('calciteInputChange', function (event) {
                self.fieldValue = event.target.value;
            });

            if (fieldSelected) {
                self.populate(fieldSelected, valueSelected);
            }
        }

        let noResultsAlert = document.getElementById('no-results');
        const panelContainer = document.getElementById('panel-container');
        const viewDiv = document.getElementById('map-container');
        const self = this;
        this.domNode = document.createElement('div');
        this.domNode.className = 'filter-box hidden';

        this.filterRows = [];
        this.query = '';
        let filterButton = document.createElement('button');
        let filterBoxes = document.querySelector('.filter-box');

        filterButton.innerHTML = `<span>${assetType}</span>`;
        filterButton.className = `asset-filter-toggle element-toggle ${featureLayer.visible ? '' : 'hidden'}`;
        filterButton.title = 'filter assets by attribute';

        let toggle = document.createElement('calcite-icon');

        toggle.setAttribute('icon', 'layer-filter');
        toggle.setAttribute('scale', 's');
        toggle.className = 'asset-filter-icon';

        filterButton.prepend(toggle);

        const filterControls = document.createElement('div');

        const filterTitle = document.createElement('div');
        filterTitle.className = 'filter-note';
        filterTitle.innerHTML = `${assetType} Filter`;

        this.queryEditor = document.createElement('div');
        this.queryEditor.className = 'query-editor';
        this.queryEditor.setAttribute('contenteditable', true);

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'button-group';

        this.applyButton = document.createElement('calcite-button');
        this.applyButton.innerHTML = 'Apply';

        this.clearButton = document.createElement('calcite-button');
        this.clearButton.innerHTML = 'Clear';

        buttonGroup.append(this.applyButton, this.clearButton);

        this.domNode.append(filterTitle, filterControls, this.queryEditor, buttonGroup);

        let extentData; // Declare a variable in a higher scope

        this.apply = function () {
            featureLayer.definitionExpression = self.queryEditor.innerText;
            // featureGrid.update();

            featureLayer
                .when(() => {
                    return featureLayer.queryExtent();
                })
                .then((response) => {
                    if (response.count === 0) {
                        noResultsAlert.setAttribute('open', '');
                    } else {
                        extentData = response.extent; // Store the extent in the variable
                        view.goTo(response.extent);
                    }
                });

            // Add the "hidden" class to the filter-box element after applying the filter
            self.domNode.classList.add('hidden');
            filterButton.classList.remove('active');
            toggle.classList.remove('active');
            if (panelContainer.classList.contains('nav-open')) {
                panelContainer.classList.remove('nav-open');
                viewDiv.classList.remove('nav-open');
            }
        };
        this.clear = function () {
            self.queryEditor.innerHTML = '';
            self.filterRows.forEach((filterRow) => {
                self.removeFilterRow(filterRow, true);
            });

            // self.jurisdiction = self.jurisdiction;
            self.addFilterRow(featureLayer);
            featureLayer.definitionExpression = self.queryEditor.innerText;
            // featureGrid.update();

            // self.apply();

            // console.log(response.extent);
        };
        this.close = function () {
            this.domNode.classList.add('hidden');
        };
        this.open = function (event) {
            const filterBoxes = document.querySelectorAll('.filter-box');

            filterBoxes.forEach((filterBox) => {
                filterBox.classList.add('hidden');
            });

            if (event) {
                let rect;

                if (event.target.nodeName === 'SPAN' || event.target.nodeName === 'CALCITE-ICON') {
                    rect = event.target.parentElement.getBoundingClientRect();
                } else {
                    rect = event.target.getBoundingClientRect();
                }

                this.domNode.style.top = `${rect.bottom + 10}px`;
                this.domNode.style.right = `${window.innerWidth - rect.right}px`;
            }

            this.domNode.classList.remove('hidden');
        };
        this.addFilterRow = function (layer, fieldSelected, operatorSelected, valueSelected, clear = false) {
            let filterRow = new FilterRow(self, layer, fieldSelected, operatorSelected, valueSelected);

            if (clear) {
                self.filterRows = [];
                filterControls.innerHTML = '';
            }

            filterControls.append(filterRow.domNode);
            self.filterRows.push(filterRow);
        };
        this.removeFilterRow = function (filterRow, clearAll = false) {
            // clear out row if a field value has been chosen
            if (filterRow.field) {
                filterRow.domNode.parentNode.removeChild(filterRow.domNode);

                self.filterRows = self.filterRows.filter((obj) => {
                    return JSON.stringify(obj) !== JSON.stringify(filterRow);
                });

                self.createQueryString();
            } else if (clearAll) {
                // if the entire selection is being removed, clear blank rows too
                if (filterRow.domNode.parentNode) {
                    filterRow.domNode.parentNode.removeChild(filterRow.domNode);
                }

                self.createQueryString();
            }
        };
        this.createQueryString = function (event, timestamp) {
            self.queryEditor.innerHTML = '';

            self.filterRows.forEach((filterRow) => {
                if (filterRow.fieldValue) {
                    function epoch(date) {
                        return Date.parse(date);
                    }

                    const dateStamp = new Date(filterRow.fieldValue);
                    const timestamp = epoch(dateStamp);

                    let querySegment = '';

                    if (filterRow.field.type === 'date') {
                        querySegment = `${filterRow.field.name} ${filterRow.operator} ${parseInt(timestamp)}`;
                    } else if (filterRow.field.type === 'small-integer' || filterRow.field.type === 'integer' || filterRow.field.type === 'double') {
                        querySegment = `${filterRow.field.name} ${filterRow.operator} ${filterRow.fieldValue}`;
                    } else if (filterRow.field.name === 'Shape__Length') {
                        querySegment = `${filterRow.field.name} ${filterRow.operator} ${filterRow.fieldValue}`;
                    } else {
                        querySegment = `${filterRow.field.name} ${filterRow.operator} '${filterRow.fieldValue}'`;
                    }

                    if (self.queryEditor.innerHTML) {
                        self.queryEditor.innerHTML += ` AND ${querySegment}`;
                    } else {
                        self.queryEditor.innerHTML = querySegment;
                    }
                }
            });
        };

        this.applyButton.addEventListener('click', this.apply);
        this.clearButton.addEventListener('click', this.clear);
        filterButton.addEventListener('click', function (event) {
            const assetFilterToggles = document.querySelectorAll('.asset-filter-toggle');
            const assetFilterIcons = document.querySelectorAll('.asset-filter-icon');

            if (filterButton.classList.contains('active')) {
                filterButton.classList.remove('active');
                toggle.classList.remove('active');

                self.close();
            } else {
                assetFilterToggles.forEach((assetFilterToggle) => {
                    assetFilterToggle.classList.remove('active');
                });

                assetFilterIcons.forEach((assetFilterIcon) => {
                    assetFilterIcon.classList.remove('active');
                });

                filterButton.classList.add('active');
                toggle.classList.add('active');

                self.open(event);
            }
        });

        reactiveUtils.watch(
            // watch for any changes done on the layer
            () => featureLayer.visible, // checks status of related table
            (visibility) => {
                const filterBoxes = document.querySelectorAll('.filter-box');
                const assetFilterToggles = document.querySelectorAll('.asset-filter-toggle');
                const assetFilterIcons = document.querySelectorAll('.asset-filter-icon');

                assetFilterToggles.forEach((assetFilterToggle) => {
                    assetFilterToggle.classList.remove('active');
                });

                assetFilterIcons.forEach((assetFilterIcon) => {
                    assetFilterIcon.classList.remove('active');
                });

                filterBoxes.forEach((filterBox) => {
                    filterBox.classList.add('hidden');
                });

                if (visibility) {
                    filterButton.classList.remove('hidden');
                } else {
                    filterButton.classList.add('hidden');
                }
            }
        );

        view.whenLayerView(featureLayer).then((layerView) => {
            reactiveUtils.watch(
                // watch for any changes done on the layer
                () => layerView.updating, // checks status of related table
                (updating) => {
                    if (updating) {
                        self.applyButton.setAttribute('loading', true);
                    } else {
                        self.applyButton.removeAttribute('loading');
                    }
                }
            );
        });

        featureLayer.when(() => {
            defaultValues.forEach((value) => {
                self.addFilterRow(featureLayer, value.field, value.operator, value.value);
            });

            self.addFilterRow(featureLayer);
            self.createQueryString();
            // self.apply();

            if (index >= 0) {
                view.ui.add(filterButton, {
                    position: 'top-right',
                    index: index,
                });
                view.ui.add(filterBoxes, {
                    position: 'top-right',
                });
            } else {
                view.ui.add(filterButton, {
                    position: 'top-right',
                });
            }

            document.body.append(this.domNode);
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

    // playButton.addEventListener('click', (event) => {
    //     viewer.setPointBudget(250_000);
    //     animation.play();
    // });
    // pauseButton.addEventListener('click', (event) => {
    //     viewer.setPointBudget(10_000_000);
    //     animation.pause();
    // });

    // fetch(baseURL + 'authenticate', {
    //     method: 'POST', // or POST, PUT, DELETE, etc.
    //     body: JSON.stringify({ username: 'mcollins@gpinet.com', password: 'bbq1ifestyle' }),
    // })
    //     .then((response) => response.json())
    //     .then((credentials) => {
    //     });

    window.viewer = new Potree.Viewer(document.getElementById('potree_render_area'));
    viewer.setEDLEnabled(true);
    viewer.setPointBudget(1_000_000);
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

    closeLidarViewerButton.addEventListener('click', (event) => {
        const mapContainer = document.getElementById('map-container');
        const potreeContainer = document.getElementById('potree-container');
        const featureTabContainer = document.querySelector('.feature-tab-container');

        featureTabContainer.classList.remove('hidden');
        mapContainer.classList.remove('hidden');
        potreeContainer.classList.add('hidden');
    });

    view.when(() => {
        const retainingWallFeatureLayer = new FeatureLayer({
            url: featureServerURL + '0',
            popupTemplate: {
                title: 'Retaining Wall: {SRI} [{MP_Start} - {MP_End}]',
                outFields: ['*'],
                content: [
                    {
                        type: 'fields',
                        fieldInfos: [
                            { fieldName: 'SRI', label: 'SRI' },
                            { fieldName: 'MP_Start', label: 'MP_Start' },
                            { fieldName: 'MP_End', label: 'MP_End' },
                            { fieldName: 'WallType', label: 'Wall Type' },
                            { fieldName: 'SideOfRoad', label: 'Side Of Road' },
                            { fieldName: 'WallLength', label: 'Wall Length (ft)' },
                            { fieldName: 'MinWallHeight', label: 'Minimum Wall Height (ft)' },
                            { fieldName: 'MaxWallHeight', label: 'Maximum Wall Height (ft)' },
                            { fieldName: 'DistanceToPavement', label: 'Distance to Pavement (ft)' },
                            { fieldName: 'GuiderailPresent', label: 'Guiderail Present' },
                            { fieldName: 'GuiderailLength', label: 'Guiderail Length (ft)' },
                            { fieldName: 'FrontSlopePresent', label: 'Front Slope Present?' },
                            { fieldName: 'FrontSlopeLength', label: 'Front Slope Length (ft)' },
                            { fieldName: 'BackSlopePresent', label: 'Back Slope Present?' },
                            { fieldName: 'BackSlopeLength', label: 'Back Slope Length (ft)' },
                            { fieldName: 'BackSlopeAngle', label: 'Back Slope Angle' },
                            { fieldName: 'Notes', label: 'Notes' },
                            { fieldName: 'Shape__Length', label: 'Shape__Length' },
                        ],
                    },
                    {
                        // if attachments are associated with feature, display it.
                        // Autocasts as new AttachmentsContent()
                        type: 'attachments',
                    },
                ],
                actions: [
                    {
                        // This text is displayed as a tooltip
                        title: 'Open Lidar',
                        // The ID by which to reference the action in the event handler
                        id: 'open-lidar',
                        // Sets the icon font used to style the action button
                        icon: 'surface',
                    },
                ],
            },
            fields: [
                new Field({ name: 'SRI', alias: 'SRI', type: 'string' }),
                new Field({ name: 'WallType', alias: 'Wall Type', type: 'string' }),
                new Field({ name: 'SideOfRoad', alias: 'Side Of Road', type: 'string' }),
                new Field({ name: 'MP_Start', alias: 'MP_Start', type: 'double' }),
                new Field({ name: 'MP_End', alias: 'MP_End', type: 'double' }),
                new Field({ name: 'WallLength', alias: 'Wall Length (ft)', type: 'double' }),
                new Field({ name: 'MinWallHeight', alias: 'Minimum Wall Height (ft)', type: 'double' }),
                new Field({ name: 'MaxWallHeight', alias: 'Maximum Wall Height (ft)', type: 'double' }),
                new Field({ name: 'DistanceToPavement', alias: 'Distance to Pavement (ft)', type: 'double' }),
                new Field({ name: 'GuiderailPresent', alias: 'Guiderail Present', type: 'string' }),
                new Field({ name: 'GuiderailLength', alias: 'Guiderail Length (ft)', type: 'double' }),
                new Field({ name: 'FrontSlopePresent', alias: 'Front Slope Present?', type: 'string' }),
                new Field({ name: 'FrontSlopeLength', alias: 'Front Slope Length (ft)', type: 'double' }),
                new Field({ name: 'BackSlopePresent', alias: 'Back Slope Present?', type: 'string' }),
                new Field({ name: 'BackSlopeLength', alias: 'Back Slope Length (ft)', type: 'double' }),
                new Field({ name: 'BackSlopeAngle', alias: 'Back Slope Angle', type: 'double' }),
                new Field({ name: 'Notes', alias: 'Notes', type: 'string' }),
                new Field({ name: 'Shape__Length', alias: 'Shape__Length', type: 'double' }),
            ],
        });
        const rockSlopeFeatureLayer = new FeatureLayer({
            url: featureServerURL + '1',
            popupTemplate: {
                title: `Rock & Soil Slope: {SRI}
                 [{MP_Start} - {MP_End}]`,
                outFields: ['*'],
                content: [
                    {
                        type: 'fields',
                        fieldInfos: [
                            { fieldName: 'SRI', label: 'SRI' },
                            { fieldName: 'MP_Start', label: 'MP_Start' },
                            { fieldName: 'MP_End', label: 'MP_End' },
                            { fieldName: 'DistanceToPavement', label: 'Distance To Pavement (ft)' },
                            { fieldName: 'Slope1Height', label: 'Slope 1 Height (ft)' },
                            { fieldName: 'Slope2Height', label: 'Slope 2 Height (ft)' },
                            { fieldName: 'Slope1Angle', label: 'Slope 1 Angle' },
                            { fieldName: 'Slope2Angle', label: 'Slope 2 Angle' },
                            { fieldName: 'MaxSlopeHeight', label: 'Max Slope Height (ft)' },
                            { fieldName: 'MeshLength', label: 'Mesh Length (ft)' },
                            { fieldName: 'FenceLength', label: 'Fence Length (ft)' },
                            { fieldName: 'Shape__Length', label: 'Shape__Length' },
                            { fieldName: 'SlopeType', label: 'Slope Type' },
                            { fieldName: 'SideOfRoad', label: 'Side of Road' },
                            { fieldName: 'SlopeDetected', label: 'Slope Detected' },
                            { fieldName: 'GuiderailPresent', label: 'Guiderail Present' },
                            { fieldName: 'CatchOfToe', label: 'Catch Of Toe' },
                            { fieldName: 'PointCloudExceeded', label: 'Point Cloud Exceeded' },
                            { fieldName: 'Mid_Slope', label: 'Mid Slope' },
                            { fieldName: 'AnchDowel', label: 'Anchor/Dowel' },
                            { fieldName: 'DrapedMesh', label: 'Draped Mesh' },
                            { fieldName: 'FencePresent', label: 'Fence Present' },
                            { fieldName: 'Notes', label: 'Notes' },
                        ],
                    },
                    {
                        // if attachments are associated with feature, display it.
                        // Autocasts as new AttachmentsContent()
                        type: 'attachments',
                    },
                ],
                actions: [
                    {
                        // This text is displayed as a tooltip
                        title: 'Open Lidar',
                        // The ID by which to reference the action in the event handler
                        id: 'open-lidar',
                        // Sets the icon font used to style the action button
                        icon: 'surface',
                    },
                ],
            },
            fields: [
                new Field({ name: 'MP_Start', alias: 'MP_Start', type: 'double' }),
                new Field({ name: 'MP_End', alias: 'MP_End', type: 'double' }),
                new Field({ name: 'DistanceToPavement', alias: 'Distance To Pavement (ft)', type: 'double' }),
                new Field({ name: 'Slope1Height', alias: 'Slope 1 Height (ft)', type: 'double' }),
                new Field({ name: 'Slope2Height', alias: 'Slope 2 Height (ft)', type: 'double' }),
                new Field({ name: 'Slope1Angle', alias: 'Slope 1 Angle', type: 'double' }),
                new Field({ name: 'Slope2Angle', alias: 'Slope 2 Angle', type: 'double' }),
                new Field({ name: 'MaxSlopeHeight', alias: 'Max Slope Height (ft)', type: 'double' }),
                new Field({ name: 'MeshLength', alias: 'Mesh Length (ft)', type: 'double' }),
                new Field({ name: 'FenceLength', alias: 'Fence Length (ft)', type: 'double' }),
                new Field({ name: 'Shape__Length', alias: 'Shape__Length', type: 'double' }),
                new Field({ name: 'SRI', alias: 'SRI', type: 'string' }),
                new Field({ name: 'SlopeType', alias: 'Slope Type', type: 'string' }),
                new Field({ name: 'SideOfRoad', alias: 'Side of Road', type: 'string' }),
                new Field({ name: 'SlopeDetected', alias: 'Slope Detected', type: 'string' }),
                new Field({ name: 'GuiderailPresent', alias: 'Guiderail Present', type: 'string' }),
                new Field({ name: 'CatchOfToe', alias: 'Catch Of Toe', type: 'string' }),
                new Field({ name: 'PointCloudExceeded', alias: 'Point Cloud Exceeded', type: 'string' }),
                new Field({ name: 'Mid_Slope', alias: 'Mid Slope', type: 'string' }),
                new Field({ name: 'AnchDowel', alias: 'Anchor/Dowel', type: 'string' }),
                new Field({ name: 'DrapedMesh', alias: 'Draped Mesh', type: 'string' }),
                new Field({ name: 'FencePresent', alias: 'Fence Present', type: 'string' }),
                new Field({ name: 'Notes', alias: 'Notes', type: 'string' }),
            ],
        });
        const crossSectionFeatureLayer = new FeatureLayer({
            url: featureServerURL + '2',
            popupTemplate: {
                title: 'Cross Section: {SRI} [{MP_Start} - {MP_End}]',
                outFields: ['*'],
                content: [
                    {
                        type: 'fields',
                        fieldInfos: [
                            { fieldName: 'SRI', label: 'SRI' },
                            { fieldName: 'Shape__Length', label: 'Shape__Length' },
                        ],
                    },
                    {
                        // if attachments are associated with feature, display it.
                        // Autocasts as new AttachmentsContent()
                        type: 'attachments',
                    },
                ],
                actions: [
                    {
                        // This text is displayed as a tooltip
                        title: 'Open Lidar',
                        // The ID by which to reference the action in the event handler
                        id: 'open-lidar',
                        // Sets the icon font used to style the action button
                        icon: 'surface',
                    },
                ],
            },
            fields: [new Field({ name: 'SRI', alias: 'SRI', type: 'string' }), new Field({ name: 'Shape__Length', alias: 'Shape__Length', type: 'double' })],
        });
        const runCoverageFeatureLayer = new FeatureLayer({
            url: featureServerURL + '3',
            maxScale: 9000,
            renderer: {
                type: 'simple',
                symbol: {
                    type: 'simple-fill',
                    color: [218, 0, 0],
                    opacity: 1,
                    outline: {
                        width: 2,
                        color: [218, 0, 0],
                    },
                },
            },
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
            popupTemplate: {
                title: 'Route Segment {NAME}',
                actions: [
                    {
                        // This text is displayed as a tooltip
                        title: 'Open Lidar',
                        // The ID by which to reference the action in the event handler
                        id: 'open-lidar',
                        // Sets the icon font used to style the action button
                        icon: 'surface',
                    },
                ],
            },
            // definitionExpression: "NAME not like '00000080_EB%' and NAME not like '00000287_SB%' and NAME not like '00000295_SB%'",
        });
        const imageryLocationFeatureLayer = new FeatureLayer({
            url: featureServerURL + '5',
            minScale: 9000,
            renderer: {
                type: 'simple',
                symbol: {
                    type: 'simple-marker',
                    style: 'circle',
                    color: [230, 0, 0, 255],
                    size: 4,
                },
            },
            fields: [
                { name: 'Filename', alias: 'Filename', type: 'string' },
                { name: 'Origin__Easting_ftUS_', alias: 'Origin (Easting(ftUS)', type: 'string' },
                { name: 'Northing_ftUS_', alias: 'Northing(ftUS)', type: 'string' },
                { name: 'SRI', alias: 'SRI', type: 'string' },
                { name: 'Direction', alias: 'Direction', type: 'string' },
                { name: 'Lidar_Segment_Name', alias: 'Lidar Segment Name', type: 'string' },
            ],
            popupTemplate: {
                title: '360 Imagery Point: {Lidar_Segment_Name}',
                content: [
                    {
                        type: 'custom', // Autocasts as new FieldsContent()
                        outFields: ['*'],
                        creator: (feature) => {
                            const imageryWindow = window.open(
                                `https://maps.gpinet.com/gpi-viewer/simple.photo.sphere/?segment=${feature.graphic.attributes.Lidar_Segment_Name}&filename=${feature.graphic.attributes.Filename}`,
                                feature.graphic.attributes.Lidar_Segment_Name,
                                'width=750,height=750,popup=true,top=0,left=' + screen.availWidth
                            );

                            imageryWindow.document.title = feature.graphic.attributes.Lidar_Segment_Name;

                            const handle = reactiveUtils.watch(
                                () => view.popup.visible,
                                (isVisible) => {
                                    if (!isVisible) {
                                        if (imageryWindow) {
                                            imageryWindow.close();
                                            handle.remove();
                                        }
                                    }
                                }
                            );
                        },
                    },
                ],
                actions: [
                    {
                        // This text is displayed as a tooltip
                        title: 'Open Lidar',
                        // The ID by which to reference the action in the event handler
                        id: 'open-lidar',
                        // Sets the icon font used to style the action button
                        icon: 'surface',
                    },
                ],
            },
        });
        const stateOutline = new GeoJSONLayer({
            url: 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/NJ_State_Boundary/FeatureServer/3/query?outFields=*&where=1%3D1&f=geojson',
            renderer: {
                type: 'simple',
                symbol: {
                    type: 'simple-fill',
                    color: [0, 0, 0, 0],
                    outline: {
                        width: 1,
                        color: [0, 0, 0, 0.3],
                    },
                },
            },
        });

        legend.layerInfos.push({ layer: retainingWallFeatureLayer, title: 'Retaining Wall' });
        legend.layerInfos.push({ layer: rockSlopeFeatureLayer, title: 'Rock & Soil Slope' });
        legend.layerInfos.push({ layer: crossSectionFeatureLayer, title: 'Cross Section' });
        legend.layerInfos.push({ layer: runCoverageFeatureLayer, title: 'Lidar Coverage' });
        legend.layerInfos.push({ layer: imageryLocationFeatureLayer, title: '360 Imagery' });

        view.ui.add(scaleBar, 'bottom-right');
        view.ui.add(basemapToggle, 'bottom-left');
        view.ui.move(['zoom'], 'top-right');
        view.popup.dockOptions = {
            buttonEnabled: true,
            position: 'bottom-left',
        };
        view.ui.add(legend, 'bottom-right');

        loadMenu(credentials)
            .then((flatLidarList) => {
                // flatLidarList
                //     .filter((path) => path.indexOf('80_EB') >= 0)
                //     .forEach((path, index) => {
                //         console.log(path);
                //         loadRouteTest(path, index === 0);
                //     });
                reactiveUtils.on(
                    () => view.popup,
                    'trigger-action',
                    async (event) => {
                        if (event.action.id === 'open-lidar') {
                            const lidarSegmentName = view.popup.selectedFeature.attributes.Lidar_Segment_Name || view.popup.selectedFeature.attributes.NAME;
                            const routeName = lidarSegmentName.split('_')[0];
                            const routeDirection = lidarSegmentName.split('_')[1];
                            const routeSegment = lidarSegmentName.split('_')[2];
                            const path = flatLidarList.filter((element) => element.indexOf(routeName) >= 0 && element.indexOf(routeDirection) >= 0 && element.indexOf('_' + routeSegment) >= 0);

                            projection.load().then(function () {
                                // the projection module is loaded. Geometries can be re-projected.

                                // projects each polygon in the array
                                // project() will use the spatial reference of the first geometry in the array
                                // as an input spatial reference. It will use the default transformation
                                // if one is required when converting from input spatial reference
                                // to the output spatial reference
                                let outSpatialReference = new SpatialReference({
                                    wkid: 3424, //Sphere_Sinusoidal projection
                                });

                                view.popup.selectedFeature.geometry = projection.project(view.popup.selectedFeature.geometry, outSpatialReference);

                                if (path.length === 1) {
                                    if (view.popup.selectedFeature.layer.title.includes('LidarCoverage')) {
                                        loadRoute(path[0], lidarSegmentName);
                                    } else {
                                        if (view.popup.selectedFeature.geometry.centroid) {
                                            view.popup.selectedFeature.geometry.centroid.z = 1000000 / view.scale;
                                            loadRoute(path[0], lidarSegmentName, view.popup.selectedFeature.geometry.centroid);
                                        } else if (view.popup.selectedFeature.geometry.extent) {
                                            view.popup.selectedFeature.geometry.extent.center.z = 1000000 / view.scale;
                                            loadRoute(path[0], lidarSegmentName, view.popup.selectedFeature.geometry.extent.center);
                                        } else {
                                            loadRoute(path[0], lidarSegmentName, { x: view.popup.selectedFeature.geometry.x, y: view.popup.selectedFeature.geometry.y, z: 1000000 / view.scale });
                                        }
                                    }
                                }
                            });
                        }
                    }
                );
            })
            .catch((error) => {
                console.log(error);
            });

        map.add(stateOutline); // adds the layer to the map
        map.add(runCoverageFeatureLayer); // adds the layer to the map
        map.add(retainingWallFeatureLayer); // adds the layer to the map
        map.add(rockSlopeFeatureLayer); // adds the layer to the map
        map.add(crossSectionFeatureLayer); // adds the layer to the map
        map.add(imageryLocationFeatureLayer); // adds the layer to the map

        let rockSlopeFeatureTable = new FeatureTable({
            view: view,
            layer: rockSlopeFeatureLayer,
            tableTemplate: {
                // autocastable to table template
                columnTemplates: [
                    { type: 'field', fieldName: 'SRI', label: 'SRI' },
                    { type: 'field', fieldName: 'MP_Start', label: 'MP Start' },
                    { type: 'field', fieldName: 'MP_End', label: 'MP End' },
                    { type: 'field', fieldName: 'DistanceToPavement', label: 'Distance To Pavement (ft)' },
                    { type: 'field', fieldName: 'Slope1Height', label: 'Slope 1 Height (ft)' },
                    { type: 'field', fieldName: 'Slope2Height', label: 'Slope 2 Height (ft)' },
                    { type: 'field', fieldName: 'Slope1Angle', label: 'Slope 1 Angle' },
                    { type: 'field', fieldName: 'Slope2Angle', label: 'Slope 2 Angle' },
                    { type: 'field', fieldName: 'MaxSlopeHeight', label: 'Max Slope Height (ft)' },
                    { type: 'field', fieldName: 'MeshLength', label: 'Mesh Length (ft)' },
                    { type: 'field', fieldName: 'FenceLength', label: 'Fence Length (ft)' },
                    { type: 'field', fieldName: 'Shape__Length', label: 'Shape__Length' },
                    { type: 'field', fieldName: 'SlopeType', label: 'Slope Type' },
                    { type: 'field', fieldName: 'SideOfRoad', label: 'Side of Road' },
                    { type: 'field', fieldName: 'SlopeDetected', label: 'Slope Detected' },
                    { type: 'field', fieldName: 'GuiderailPresent', label: 'Guiderail Present' },
                    { type: 'field', fieldName: 'CatchOfToe', label: 'Catch Of Toe' },
                    { type: 'field', fieldName: 'PointCloudExceeded', label: 'Point Cloud Exceeded' },
                    { type: 'field', fieldName: 'Mid_Slope', label: 'Mid Slope' },
                    { type: 'field', fieldName: 'AnchDowel', label: 'Anchor/Dowel' },
                    { type: 'field', fieldName: 'DrapedMesh', label: 'Draped Mesh' },
                    { type: 'field', fieldName: 'FencePresent', label: 'Fence Present' },
                    { type: 'field', fieldName: 'Notes', label: 'Notes' },
                ],
            },
            container: 'rock-slope-feature-table-container',
        });
        rockSlopeFeatureTable.visibleElements.selectionColumn = false;
        rockSlopeFeatureTable.on('cell-click', (event) => {
            if (rockSlopeFeatureTable.highlightIds.includes(event.objectId)) {
                rockSlopeFeatureTable.highlightIds.remove(event.objectId);
            } else {
                rockSlopeFeatureTable.highlightIds.push(event.objectId);
            }
        });

        let retainingWallFeatureTable = new FeatureTable({
            view: view,
            layer: retainingWallFeatureLayer,
            tableTemplate: {
                columnTemplates: [
                    { type: 'field', fieldName: 'SRI', label: 'SRI' },
                    { type: 'field', fieldName: 'MP_Start', label: 'MP_Start' },
                    { type: 'field', fieldName: 'MP_End', label: 'MP_End' },
                    { type: 'field', fieldName: 'WallType', label: 'Wall Type' },
                    { type: 'field', fieldName: 'SideOfRoad', label: 'Side Of Road' },
                    { type: 'field', fieldName: 'WallLength', label: 'Wall Length (ft)' },
                    { type: 'field', fieldName: 'MinWallHeight', label: 'Minimum Wall Height (ft)' },
                    { type: 'field', fieldName: 'MaxWallHeight', label: 'Maximum Wall Height (ft)' },
                    { type: 'field', fieldName: 'DistanceToPavement', label: 'Distance to Pavement (ft)' },
                    { type: 'field', fieldName: 'GuiderailPresent', label: 'Guiderail Present' },
                    { type: 'field', fieldName: 'GuiderailLength', label: 'Guiderail Length (ft)' },
                    { type: 'field', fieldName: 'FrontSlopePresent', label: 'Front Slope Present?' },
                    { type: 'field', fieldName: 'FrontSlopeLength', label: 'Front Slope Length (ft)' },
                    { type: 'field', fieldName: 'BackSlopePresent', label: 'Back Slope Present?' },
                    { type: 'field', fieldName: 'BackSlopeLength', label: 'Back Slope Length (ft)' },
                    { type: 'field', fieldName: 'BackSlopeAngle', label: 'Back Slope Angle' },
                    { type: 'field', fieldName: 'Notes', label: 'Notes' },
                    { type: 'field', fieldName: 'Shape__Length', label: 'Shape__Length' },
                ],
            },
            container: 'retaining-wall-feature-table-container',
        });
        retainingWallFeatureTable.visibleElements.selectionColumn = false;
        retainingWallFeatureTable.on('cell-click', (event) => {
            if (retainingWallFeatureTable.highlightIds.includes(event.objectId)) {
                retainingWallFeatureTable.highlightIds.remove(event.objectId);
            } else {
                retainingWallFeatureTable.highlightIds.push(event.objectId);
            }
        });

        new AssetFilter(view, 'Retaining Wall', retainingWallFeatureLayer);
        new AssetFilter(view, 'Rock & Soil Slope', rockSlopeFeatureLayer);
    });
});
