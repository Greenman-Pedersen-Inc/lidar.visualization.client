// import esriId from '@arcgis/core/identity/IdentityManager.js';
// import ServerInfo from '@arcgis/core/identity/ServerInfo.js';
// import StorageUtils from '../widgets/StorageUtils';
// import { MDCTextField } from '@material/textfield';
// import { MDCTopAppBar } from '@material/top-app-bar';
// import URL from '../widgets/URL';

// import backgroundimage from '../img/guiderailView.jpg';
// import camdenSeal from '../img/camdenCClogo.png';
// import './index.css';

const loginButton = document.getElementById('login-button');
const forgotPassword = document.getElementById('password-reset-id');
const topAppBar = new MDCTopAppBar(document.querySelector('.mdc-top-app-bar'));
const usernameTextField = new MDCTextField(document.getElementById('username-text-field'));
const passwordTextField = new MDCTextField(document.getElementById('password-text-field'));
const progressLoader = document.getElementById('progress-sign-in');
const serverInfo = new ServerInfo();

function signIn(username, password) {
    const credentials = { username: username, password: password };

    showProgress(true);
    document.getElementById('password-helper-id').innerHTML = '';

    esriId.generateToken(serverInfo, credentials).then(
        function (response) {
            if (response) {
                response.userId = username;
                response.ssl = true;
                response.server = URL.featureServer;

                esriId.registerToken(response);

                if (esriId.credentials.length === 0) {
                    showProgress(false);
                    return;
                }

                try {
                    StorageUtils.storeCredientialsInStorage(JSON.stringify(esriId.toJSON()));
                } catch (e) {
                    console.error(e);
                }

                usernameTextField.value = '';
                passwordTextField.value = '';
                window.location.href = '../map';
            } else {
                passwordTextField.value = '';
            }
            showProgress(false);
        },
        function (error) {
            // This function is called when the promise is rejected
            document.getElementById('password-helper-id').innerHTML = error.details.messages[0];
            showProgress(false);
        }
    );
}

function sendPasswordReset() {
    const username = usernameTextField.value;
    const url = `${URL.passwordReset}${username}`;

    fetch(url).then((response) => {
        console.log(response);
        if (response.status == 200) {
            console.log('Reset email sent.');
        } else {
            console.log('Failed to send password reset email. Please contact an administrator.');
        }
    });
}

function showProgress(show) {
    progressLoader.style.display = show ? 'flex' : 'none';
    loginButton.disabled = show;
}

document.getElementById('background-image').style.backgroundImage = `url(${backgroundimage})`;
document.querySelector('.camdenLogo').src = camdenSeal;

serverInfo.server = URL.featureServer;
serverInfo.tokenServiceUrl = URL.token;
serverInfo.shortLivedTokenValidity = 720;
serverInfo.webTierAuth = true;
esriId.registerServers([serverInfo]);

loginButton.addEventListener('click', function () {
    signIn(usernameTextField.value, passwordTextField.value);
});

forgotPassword.addEventListener('click', function () {
    sendPasswordReset();
});
