# Atlantic Gate Logistics — website, 3D edition (test build)

A single-page, scroll-driven website for an import/export logistics company. It's plain HTML, CSS and JavaScript, so there's no framework and nothing to build.

> **Test build:** every element marked `data-demo` in `index.html` holds sample details for a fictional company. That covers the contact details, company facts, licences, client names and testimonials. Replace them with real information before launch.

## Files

```
index.html               the whole site (styles and script included)
media/f/d/001–121.webp   3D hero frames for wide screens (1440×810)
media/f/m/001–121.webp   3D hero frames for portrait screens (810×1440)
media/poster.webp        first frame
scene/ag3d.js            the WebGL scene the frames were rendered from
vercel.json              caching headers for the media files
```

The hero is an original 3D scene (RTG crane, containers, truck, Lagos port), modelled
and lit in `scene/ag3d.js` and rendered to the frame images above. Re-render by opening
`scene/preview.html?w=1440&h=810` in Chrome and calling `draw(t)` for t = 0…1.

## Settings

At the top of the `<script>` in `index.html`:

```js
var CONFIG = {
  whatsappNumber: '',   // international format, digits only, e.g. country code + number
  quoteEndpoint: ''     // URL of a form service that accepts a JSON POST (e.g. Formspree)
};
```

- With `whatsappNumber` set, the floating button opens a WhatsApp chat. The tracking and quote forms also offer to send their details over WhatsApp.
- With `quoteEndpoint` set, quote requests are POSTed there as JSON. The page only shows a success message when the service accepts the request.

## Run locally

The page loads its media with `fetch()`, so open the site through a local server rather than by double-clicking the file:

```bash
npx serve .            # or: python3 -m http.server 8000
```

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Framework preset: **Other**. Leave the build command empty and keep the output directory as the root.
4. Click **Deploy**.

Or, with the Vercel CLI, run `vercel` from this folder.
