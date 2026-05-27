// postcss.config.mjs
// Tailwind CSS v4 uses CSS-first configuration — no tailwind.config.ts needed.
// The @tailwindcss/postcss plugin handles everything.

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
