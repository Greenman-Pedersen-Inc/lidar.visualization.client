'use strict';

const AUTH_STORAGE_KEY = 'gams_auth_session';
window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
const form = document.querySelector('#login-form');
const usernameInput = document.querySelector('#username');
const passwordInput = document.querySelector('#password');
const submitButton = document.querySelector('#submit');
const spinner = document.querySelector('.spinner');
const errorMessage = document.querySelector('#login-error');

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorMessage.classList.add('hidden');
    submitButton.classList.remove('error');
    submitButton.disabled = true;
    spinner.classList.remove('hidden');

    try {
        const response = await fetch('../data/v1/authenticate', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: usernameInput.value,
                password: passwordInput.value,
            }),
        });

        if (!response.ok) {
            throw new Error(`Authentication failed with status ${response.status}`);
        }

        const auth = await response.json();
        if (!auth?.token || typeof auth.token !== 'string' || !Number.isFinite(Number(auth.expiry))) {
            throw new Error('Authentication response was missing required fields');
        }

        window.sessionStorage.setItem(
            AUTH_STORAGE_KEY,
            JSON.stringify({ token: auth.token, expiry: Number(auth.expiry) }),
        );
        window.location.assign('../map/');
    } catch (error) {
        console.error('Login request failed', error);
        errorMessage.classList.remove('hidden');
        submitButton.classList.add('error');
        passwordInput.value = '';
        passwordInput.focus();
    } finally {
        submitButton.disabled = false;
        spinner.classList.add('hidden');
    }
});
