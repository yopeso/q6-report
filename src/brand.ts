/** An image a suite gives the page, carried as data so the page stays one file. */
export interface BrandImage {
  type: 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  base64: string;
  /** Draw it in the colour of the text around it, so a one-colour logo reads on both themes. */
  isOneColour?: boolean;
}

/** The footer's words and the logo beside them, set together, so a suite's own words never sit beside another's logo. */
export interface BrandFooter {
  text: string;
  logo?: BrandImage;
}

export interface Brand {
  /** In the page's title and its header. */
  name: string;
  footer: BrandFooter;
  /** A colour as #rrggbb. */
  accent?: string;
  /** In the header; the footer draws its own. */
  logo?: BrandImage;
  favicon?: BrandImage;
}

export const DEFAULT_ACCENT = '#ffa800';

// Yopeso's logo, in the text colour of whichever theme the page is on. btoa, as the page's own code carries it too.
const YOPESO_LOGO = `<svg width="800" height="162" viewBox="0 0 800 162" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M390.571 29.7977C383.422 12.7704 366.845 1.21617 346.768 1.06414C332.776 1.06414 318.632 1.3682 304.639 0.912109C304.335 0.912109 304.031 0.912109 303.727 0.912109C303.27 0.912109 302.814 0.912109 302.358 0.912109C286.692 1.52023 274.829 13.9866 274.373 29.7977C274.373 30.1017 274.373 30.4058 274.373 30.7099C274.373 31.0139 274.373 31.318 274.373 31.7741C274.829 47.7371 274.525 63.8522 274.525 79.9674C274.525 96.8426 274.373 113.87 274.525 130.745C274.677 143.06 281.521 153.398 291.711 158.11C293.537 158.871 295.362 159.631 297.339 160.087C299.012 160.543 300.685 160.695 302.358 160.847C313.613 161.607 324.107 155.678 329.886 144.884L330.191 144.428L332.32 140.323C336.883 131.201 341.445 121.927 346.16 112.806C346.921 111.285 347.681 109.765 348.594 108.245C349.962 105.812 352.092 103.38 354.373 101.86C360.153 97.7548 366.388 94.4101 372.32 90.4574C386.008 81.3356 393.917 68.4131 394.677 51.5379C394.677 43.7844 393.308 36.3349 390.571 29.7977ZM357.567 65.8286C351.179 70.0854 344.639 74.1902 338.099 78.143C333.08 81.1836 329.126 85.1364 326.084 90.0013L315.59 110.829L311.027 119.799L306.16 129.529C305.248 131.353 302.358 130.745 302.358 128.617V32.9903C302.358 31.318 303.727 29.7977 305.552 29.7977H346.16C356.654 29.7977 364.259 36.0309 366.084 45.9128C367.757 53.5143 364.259 61.4198 357.567 65.8286Z" fill="currentColor"/>
<path d="M103.878 37.8551C114.22 37.8551 122.737 29.4935 122.737 19.0035C122.737 8.6655 114.372 0.151855 103.878 0.151855C93.3838 0.151855 85.1709 8.6655 85.1709 19.0035C85.1709 29.4935 93.5359 37.8551 103.878 37.8551Z" fill="currentColor"/>
<path d="M479.392 99.7311C489.734 99.7311 498.251 91.3695 498.251 80.8795C498.251 70.5415 489.886 62.0278 479.392 62.0278C469.049 62.0278 460.532 70.3894 460.532 80.8795C460.532 91.3695 469.049 99.7311 479.392 99.7311Z" fill="currentColor"/>
<path d="M117.414 84.3761V157.35C117.414 159.022 116.046 160.391 114.373 160.391H92.0152C90.3422 160.391 88.9734 159.022 88.9734 157.35V87.5687C88.9734 85.7443 87.7566 84.072 85.9315 83.6159L28.4411 66.8927L20.3802 64.6123C8.36502 60.9635 0 49.8654 0 37.399V3.6485C0 1.97617 1.36882 0.60791 3.04182 0.60791H25.3992C27.0722 0.60791 28.4411 1.97617 28.4411 3.6485V34.2064C28.4411 36.0307 29.6578 37.7031 31.4829 38.1592L89.1255 54.8824L97.1863 57.1628C109.202 60.8115 117.414 71.9097 117.414 84.3761Z" fill="currentColor"/>
<path d="M440.456 32.8383V128.769C440.456 130.441 441.825 131.809 443.498 131.809H520.456C522.129 131.809 523.498 133.178 523.498 134.85V157.806C523.498 159.479 522.129 160.847 520.456 160.847H440.304C424.639 160.847 411.863 148.076 411.863 132.417V29.3416C411.863 13.6826 424.639 0.912109 440.304 0.912109H520.456C522.129 0.912109 523.498 2.28037 523.498 3.9527V26.7571C523.498 28.4294 522.129 29.7977 520.456 29.7977H443.498C441.825 29.7977 440.456 31.1659 440.456 32.8383Z" fill="currentColor"/>
<path d="M662.814 104.292V132.569C662.814 148.076 650.19 160.847 634.525 160.847H551.483C549.81 160.847 548.441 159.479 548.441 157.806V135.458C548.441 133.786 549.81 132.417 551.483 132.417H631.331C633.004 132.417 634.373 131.049 634.373 129.377V106.725C634.373 105.356 633.46 104.14 632.244 103.836L573.84 86.8087L565.628 84.3762C553.612 80.8795 545.399 69.9334 545.399 57.467V29.1896C545.399 13.6826 558.023 0.912109 573.688 0.912109H656.73C658.403 0.912109 659.772 2.28037 659.772 3.9527V26.149C659.772 27.8213 658.403 29.1896 656.73 29.1896H576.882C575.209 29.1896 573.84 30.5578 573.84 32.2301V55.0345C573.84 56.4028 574.753 57.619 575.97 57.9231L634.373 74.9504L642.586 77.3829C654.601 80.8795 662.814 91.8256 662.814 104.292Z" fill="currentColor"/>
<path d="M139.468 51.5379V110.221C139.468 138.195 162.129 160.847 190.114 160.847H206.388C234.373 160.847 257.034 138.195 257.034 110.221V51.5379C257.034 23.5645 234.373 0.912109 206.388 0.912109H190.114C162.129 0.912109 139.468 23.5645 139.468 51.5379ZM206.996 133.482H189.506C177.491 133.482 167.605 123.752 167.605 111.589V50.3216C167.605 38.3113 177.339 28.4294 189.506 28.4294H206.996C219.012 28.4294 228.897 38.1593 228.897 50.3216V111.589C228.897 123.6 219.012 133.482 206.996 133.482Z" fill="currentColor"/>
<path d="M682.434 51.5379V110.221C682.434 138.195 705.095 160.847 733.08 160.847H749.354C777.339 160.847 800 138.195 800 110.221V51.5379C800 23.5645 777.339 0.912109 749.354 0.912109H733.08C705.095 0.912109 682.434 23.5645 682.434 51.5379ZM749.962 133.482H732.472C720.456 133.482 710.57 123.752 710.57 111.589V50.3216C710.57 38.3113 720.304 28.4294 732.472 28.4294H749.962C761.977 28.4294 771.863 38.1593 771.863 50.3216V111.589C771.863 123.6 762.129 133.482 749.962 133.482Z" fill="currentColor"/>
</svg>`;

export const DEFAULT_BRAND: Brand = {
  name: 'q6-report',
  footer: { text: 'Generated by q6', logo: { type: 'image/svg+xml', base64: btoa(YOPESO_LOGO), isOneColour: true } },
};

const IMAGE_TYPES = new Set<string>(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function checkImage(what: string, image: BrandImage | undefined): void {
  if (!image) return;
  if (!IMAGE_TYPES.has(image.type))
    throw new Error(`The brand's ${what} is ${String(image.type)}; it has to be SVG, PNG, JPEG, WebP or GIF.`);
  if (!BASE64.test(image.base64)) throw new Error(`The brand's ${what} is not base64; pass the file's bytes encoded as base64.`);
}

/** Both reach the page's CSS as a url() and a colour, so they are held to exactly what those accept. */
export function checkBrand(brand: Partial<Brand>): void {
  if (brand.footer !== undefined && typeof brand.footer?.text !== 'string')
    throw new Error(`The brand's footer is ${JSON.stringify(brand.footer)}; pass it as { text, logo }, e.g: { text: 'Made by Acme' }.`);
  if (brand.accent !== undefined && !/^#[0-9a-f]{6}$/i.test(brand.accent))
    throw new Error(`The brand's accent is "${brand.accent}"; write it as #rrggbb, e.g: ${DEFAULT_ACCENT}.`);
  checkImage('logo', brand.logo);
  checkImage('footer logo', brand.footer?.logo);
  checkImage('favicon', brand.favicon);
}

const channels = (hex: string): number[] => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));

/** The share of `over` laid on `under`, as #rrggbb. */
function mix(over: string, under: string, share: number): string {
  const [from, to] = [channels(over), channels(under)];
  return `#${from
    .map((value, i) =>
      Math.round(value * share + to[i]! * (1 - share))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function isLight(hex: string): boolean {
  const [red, green, blue] = channels(hex) as [number, number, number];
  return (red * 299 + green * 587 + blue * 114) / 1000 > 140;
}

const textOn = (hex: string): string => (isLight(hex) ? '#292929' : '#ffffff');

/**
 * The tones a page derives from an accent. The default accent draws from the stylesheet's own tuned values, so a page
 * on it gets nothing here.
 */
export function accentCss(accent: string | undefined): string {
  if (!accent || accent.toLowerCase() === DEFAULT_ACCENT) return '';
  // A dark accent would vanish on the dark theme, so that theme draws a lighter tone of it.
  const onDark = isLight(accent) ? accent : mix(accent, '#ffffff', 0.45);
  return (
    `:root{--brand:${accent};--brand-deep:${mix(accent, '#000000', 0.85)};--brand-soft:${mix(accent, '#ffffff', 0.08)};--on-brand:${textOn(accent)};--brand-bar:linear-gradient(${accent},${accent})}` +
    `:root[data-theme="dark"]{--brand:${onDark};--brand-deep:${onDark};--brand-soft:${mix(accent, '#262626', 0.15)};--on-brand:${textOn(onDark)};--brand-bar:linear-gradient(${onDark},${onDark})}`
  );
}
