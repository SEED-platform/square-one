/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Roboto', 'Arial', 'sans-serif'],
      },
      colors: {
        'nrel-dark-blue': '#0B5E90',
        'nrel-second-dark-blue': '#0079C2',
        'nrel-second-dark-grey': '#5E6A71',
        'nrel-darkest-grey': '#4B545A',
        'nrel-light-grey': '#D1D5D8',
        'nrel-light-black': '#3A4246',
      },
      borderWidth: {
        3: '3px', // Add a new border width class `border-3`
      },
    },
  },
  plugins: [],
}
