import { createParts } from '../levels/parts.js';
import { expandStructures } from './schema.js';

// Roof access and rooftop routes named by the model, expanded into the same parts a
// hand-built level uses. The validator has already fixed every dimension, so this only
// has to hand the description over.
export function buildStructures(b, layout) {
  const parts = createParts(b);
  for (const s of expandStructures(layout, layout.buildings)) {
    if (s.type === 'bridge') {
      parts.skybridge(s);
      continue;
    }
    parts.switchback({ ...s.host, face: s.face, flights: s.flights });
    b.ring(s.rect.x, s.host.h + 1.2, s.rect.z, 'y');
  }
}
