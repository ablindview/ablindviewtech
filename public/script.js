/* A Blind View Tech — progressive enhancement only.
   The page works fully without this file: the form posts normally with the
   browser's own validation, and the theme follows the device. This script
   adds a manual theme override and inline validation with clear
   announcements, following the error-summary pattern. */
(function () {
  'use strict';

  var root = document.documentElement;

  /* ---------- Theme override (hidden until JS can make it work) ---------- */
  var switchEl = document.getElementById('theme-switch');
  if (switchEl) {
    switchEl.hidden = false;
    var saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) { /* storage unavailable */ }
    var current = (saved === 'light' || saved === 'dark') ? saved : 'system';
    var radio = switchEl.querySelector('input[value="' + current + '"]');
    if (radio) radio.checked = true;

    switchEl.addEventListener('change', function (ev) {
      var value = ev.target && ev.target.value;
      if (value === 'light' || value === 'dark') {
        root.setAttribute('data-theme', value);
        try { localStorage.setItem('theme', value); } catch (e) { /* ignore */ }
      } else {
        root.removeAttribute('data-theme');
        try { localStorage.removeItem('theme'); } catch (e) { /* ignore */ }
      }
    });
  }

  /* ---------- Footer year ---------- */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------- "Sorry" page: explain why, when the server told us ---------- */
  var reason = document.getElementById('sorry-reason');
  if (reason) {
    var r = new URLSearchParams(location.search).get('r');
    var copy = reason.getAttribute('data-' + r);
    if (copy) reason.textContent = copy;
  }

  /* ---------- Contact form ---------- */
  var form = document.getElementById('contact-form');
  if (!form || !window.fetch) return;
  form.setAttribute('novalidate', '');

  var status = document.getElementById('form-status');
  var started = document.getElementById('started');
  if (started) started.value = String(Date.now());

  var fields = {
    name: { el: form.elements.name, error: document.getElementById('name-error') },
    email: { el: form.elements.email, error: document.getElementById('email-error') },
    message: { el: form.elements.message, error: document.getElementById('message-error') }
  };

  function setError(field, text) {
    text = text || '';
    if (field.error.textContent !== text) field.error.textContent = text;
    if (text) {
      field.el.setAttribute('aria-invalid', 'true');
    } else {
      field.el.removeAttribute('aria-invalid');
    }
  }

  function validEmail(v) {
    // Deliberately permissive: the server does the real check.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function checkOne(key) {
    var field = fields[key];
    var value = field.el.value.trim();
    var problem = '';
    if (key === 'name' && !value) problem = 'Enter your name.';
    if (key === 'email') {
      if (!value) problem = 'Enter your email address.';
      else if (!validEmail(value)) problem = 'Enter an email address in the right format, like name@example.com.';
    }
    if (key === 'message' && !value) problem = 'Tell me a little about what you need.';
    setError(field, problem);
    return problem;
  }

  function validate() {
    var problems = [];
    ['name', 'email', 'message'].forEach(function (key) {
      var problem = checkOne(key);
      if (problem) problems.push({ field: fields[key], text: problem });
    });
    return problems;
  }

  function clearStatus() {
    status.className = 'status-box';
    status.textContent = '';
  }

  function showStatus(kind, lines) {
    clearStatus();
    status.className = 'status-box ' + kind;
    lines.forEach(function (line) {
      var p = document.createElement('p');
      p.textContent = line;
      status.appendChild(p);
    });
  }

  function showErrorSummary(problems) {
    clearStatus();
    status.className = 'status-box err';
    var heading = document.createElement('h3');
    heading.textContent = problems.length === 1 ? 'There is a problem' : 'There are ' + problems.length + ' problems';
    status.appendChild(heading);
    var list = document.createElement('ul');
    problems.forEach(function (item) {
      var li = document.createElement('li');
      var link = document.createElement('a');
      link.href = '#' + item.field.el.id;
      link.textContent = item.text;
      link.addEventListener('click', function (ev) {
        ev.preventDefault();
        item.field.el.focus();
      });
      li.appendChild(link);
      list.appendChild(li);
    });
    status.appendChild(list);
    status.focus();
  }

  // Re-check only the field being edited, once it has been flagged.
  Object.keys(fields).forEach(function (key) {
    fields[key].el.addEventListener('input', function () {
      if (fields[key].el.getAttribute('aria-invalid') === 'true') checkOne(key);
    });
  });

  var sending = false;
  var button = form.querySelector('button[type="submit"]');

  function finish() {
    sending = false;
    button.removeAttribute('aria-disabled');
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (sending) return;

    var problems = validate();
    if (problems.length) {
      showErrorSummary(problems);
      return;
    }

    sending = true;
    button.setAttribute('aria-disabled', 'true');
    showStatus('', ['Sending your message…']);

    var body = {
      name: fields.name.el.value.trim(),
      email: fields.email.el.value.trim(),
      org: form.elements.org.value.trim(),
      message: fields.message.el.value.trim(),
      contact_extra: form.elements.contact_extra.value,
      started: started ? started.value : ''
    };

    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok && data.ok) {
          form.reset();
          if (started) started.value = String(Date.now());
          showStatus('ok', [
            'Thanks, ' + body.name + '. Your message is on its way.',
            'I’ll reply to ' + body.email + ' within two business days.'
          ]);
        } else {
          showStatus('err', [
            data.error || 'Sorry, the message could not be sent right now.',
            'You can email me directly at dwayne@abvtech.net.'
          ]);
        }
        status.focus();
      });
    }).catch(function () {
      showStatus('err', [
        'Sorry, the message could not be sent. Check your connection and try again.',
        'You can also email me directly at dwayne@abvtech.net.'
      ]);
      status.focus();
    }).then(finish, finish);
  });
})();
