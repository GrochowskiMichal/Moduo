// The stream candidates the harness can mount. The Legend List entry exists
// only on the reference branch t/maciej/cv-0-s1-legend.

import type { ComponentType } from "react";
import { LegendStream } from "./legend-stream";
import type { StreamProps } from "./model";
import { TanstackStream } from "./tanstack-stream";

export const STREAMS: Record<string, ComponentType<StreamProps>> = {
  tanstack: TanstackStream,
  legend: LegendStream,
};
