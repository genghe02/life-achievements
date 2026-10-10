// The connector lines between nodes: every path in a black outline group (6px), then the
// coloured lines on top, one group per state (2px), as the demo draws them.

import { memo } from 'react';
import type { Segment } from '../../domain/layout';
import type { NodeStatus } from '../../domain/types';

const STATES: readonly NodeStatus[] = ['locked', 'open', 'done'];

interface Props {
  segs: readonly Segment[];
  width: number;
  height: number;
}

export const Connectors = memo(function Connectors({ segs, width, height }: Props) {
  return (
    <svg className="links" width={width} height={height} viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges" aria-hidden="true">
      <g className="lo">
        {segs.map((s, i) => <path key={i} d={s.d} />)}
      </g>
      {STATES.map(st => (
        <g key={st} className={`li ${st}`}>
          {segs.map((s, i) => (s.state === st ? <path key={i} d={s.d} /> : null))}
        </g>
      ))}
    </svg>
  );
});
