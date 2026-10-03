/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#101b19",
          panel: "#182522",
          secondary: "#1e2d29",
          line: "#30413c",
          muted: "#a1b2ac",
          text: "#f2f5ef",
          green: "#b8ed87",
          "green-dark": "#294532",
          gold: "#f4ca75",
          red: "#ff8f82",
          blue: "#8ec7ff"
        }
      },
      borderRadius: {
        panel: "18px"
      },
      boxShadow: {
        glow: "0 24px 80px rgba(0, 0, 0, 0.22)"
      }
    }
  },
  plugins: []
};
