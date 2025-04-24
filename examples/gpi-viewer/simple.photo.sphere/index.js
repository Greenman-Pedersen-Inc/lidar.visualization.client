import { Viewer } from '@photo-sphere-viewer/core';

const baseUrl = 'https://maps.gpinet.com/gpi-viewer/route.info';

const incomingURL = window.location.href;
const parsedURL = new URL(incomingURL);
const directoryInfo = parsedURL.searchParams.get('segment').split('_');
const route = ('00000000' + directoryInfo[0]).slice(-8);

const direction = directoryInfo[1];
const fileName = parsedURL.searchParams.get('filename');
const imagePath = `${baseUrl}/${route}__/${direction}/photos/${fileName}`;

console.log(imagePath);

new Viewer({
    container: 'viewer',
    panorama: imagePath,
});
