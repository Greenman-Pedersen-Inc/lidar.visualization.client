import { Viewer } from '@photo-sphere-viewer/core';

const baseUrl = 'http://localhost:1234/examples/gpi-viewer/simple.photo.sphere/photos/';

new Viewer({
    container: 'viewer',
    panorama: baseUrl + '241015_184833902.jpg',
});
