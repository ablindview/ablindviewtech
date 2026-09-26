# A Blind View Tech — ablindviewtech.com

Portfolio and services site for A Blind View Tech (Dwayne Davis): accessible, secure websites for small businesses and nonprofits.

Static HTML, CSS and a little JavaScript with no build step, plus one Cloudflare Pages Function for the contact form.

## Accessibility

Built to WCAG 2.2 AA and tested with VoiceOver, JAWS and NVDA:

- Semantic landmarks, one `h1`, logical heading order, a skip link, and a focusable `main`.
- Light/dark follows the device (`prefers-color-scheme`); an "Appearance" radio group in the header overrides it and remembers the choice. Text contrast is at least 4.5:1 in both themes; focus rings are 3px, high-contrast, and distinct from the brand color.
- All controls are at least 44×44 CSS pixels. Motion respects `prefers-reduced-motion`.
- The contact form has visible labels, hints tied in with `aria-describedby`, inline errors announced through a live region, and it still works with JavaScript disabled.
- `public/accessibility.html` is the public accessibility statement.

Run the automated check locally: `npm run a11y` (serves `public/` and runs axe-core on every page).

## Layout

```
public/                static site (deployed as-is)
  index.html           home page
  accessibility.html   accessibility statement
  thanks.html          shown after a no-JavaScript form submission
  sorry.html           shown if a no-JavaScript submission fails
  styles.css, script.js, theme-init.js
  _headers             security headers and CSP for Cloudflare Pages
  assets/              logo and icons
functions/api/contact.js   Pages Function: POST /api/contact
wrangler.toml          Pages project config
```

## Local preview

```
npx wrangler pages dev public
```

That serves the site with the `_headers` file and the contact function. To exercise the form locally, copy `.dev.vars.example` to `.dev.vars` and fill in real values.

## Contact form (currently paused)

The form is switched off while Dwayne is not accepting new clients. The "Availability" section of `public/index.html` carries the notice in its place, and `functions/api/contact.js` answers every submission with 503 because `ACCEPTING_CLIENTS` is `false`.

To reopen it: set `ACCEPTING_CLIENTS = true` in `functions/api/contact.js`, put the form markup back in the Availability section of `public/index.html` (see the git history for the original block), and change the hero and nav buttons back to "Start a project" and "Hire me". The Resend configuration below stays valid in the meantime.

## Contact form setup (one time)

The form emails you through [Resend](https://resend.com).

1. In Resend, add and verify the `ablindviewtech.com` domain (it gives you DNS records to add in Cloudflare), then create an API key.
2. `CONTACT_TO` and `CONTACT_FROM` are plain variables and already live in `wrangler.toml` (because a `wrangler.toml` exists, Cloudflare reads non-secret variables from it, not from the dashboard). Edit them there if the addresses change.
3. Add the secret, either in the dashboard (Pages project → **Settings → Variables and Secrets** → `RESEND_API_KEY`, type Secret) or from the terminal:

   ```
   npx wrangler pages secret put RESEND_API_KEY --project-name ablindviewtech
   ```

Until the key is set, the form answers with a friendly "isn't set up yet" message and offers the email address instead.

Spam is filtered by a honeypot field and a minimum fill time. For rate limiting, the simplest strong option is a Cloudflare WAF rate-limiting rule on `POST /api/contact` (free plan). Alternatively create a KV namespace and uncomment the `RATE_LIMIT` binding in `wrangler.toml` to limit each connection to 5 messages an hour.

## Deploy

Every push to `main` deploys automatically once the GitHub repository is connected to the Pages project in the Cloudflare dashboard. To deploy by hand:

```
npx wrangler pages deploy public --project-name ablindviewtech
```

## Domains

`ablindviewtech.com` and `www.ablindviewtech.com` are attached to the Pages project as custom domains, and `ablindviewtech.pages.dev` also serves the site. The pages declare `ablindviewtech.com` as their canonical URL. A `_redirects` file cannot send one hostname to another (its source must be a path), so if you want `www` to redirect to the apex, add a Redirect Rule on the zone instead: Cloudflare dashboard → ablindviewtech.com → Rules → Redirect Rules.

## Adding testimonials

`public/index.html` has a commented-out template in the "Why clients trust me" section. Paste real client quotes there with the person's name and organization.
