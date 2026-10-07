// Global test setup. Adds jest-dom matchers (toBeInTheDocument, toHaveClass, …)
// so future component-render tests get them without a per-file import.

import { expect } from "@rstest/core";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

expect.extend(jestDomMatchers);
