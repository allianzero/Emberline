// The look plan, in one place. A dusk foundry yard: warm charcoal ground, rusted
// steel, one ember-orange accent for the EMBER team and one cold cyan for ASH.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#191411', // dusk sky / background
  surface: '#26201a', // walls, containers
  hairline: '#3b3128', // crates, trim
  ink: '#f2e8dc', // text, light metal
  muted: '#a89a8a', // dim concrete, secondary text
  accent: '#ff7a2f', // ember orange: EMBER team, muzzle, highlights
  cyan: '#37c8c3', // cold cyan: ASH team
  ground: '#241d18', // yard floor
  rust: '#8a4a26', // rusted panels
  danger: '#e5484d', // charge, damage
};

export function shade(name) {
  return PALETTE[name];
}
