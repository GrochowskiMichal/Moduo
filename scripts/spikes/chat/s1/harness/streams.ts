// The stream candidates the harness can mount. The Legend List variant
// (legend-stream.tsx, with @legendapp/list in package.json) lives on the
// reference branch t/maciej/cv-0-s1-legend; here only TanStack Virtual.

import type { ComponentType } from "react";
import type { StreamProps } from "./model";
import { TanstackStream } from "./tanstack-stream";

export const STREAMS: Record<string, ComponentType<StreamProps>> = {
  tanstack: TanstackStream,
};
