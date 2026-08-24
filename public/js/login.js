'use strict';

const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const btn = document.getElementById('loginBtn');

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add('show');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('show');

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) return showError('Kullanıcı adı ve şifre zorunludur.');

  btn.disabled = true;
  btn.textContent = 'Giriş yapılıyor...';

  try {
    await API.post('/api/auth/login', { username, password });
    location.href = '/kayit.html';
  } catch (err) {
    showError(err.message);
    document.getElementById('password').value = '';
    document.getElementById('password').focus();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Giriş Yap';
  }
});
