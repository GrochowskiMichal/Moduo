// TS-3b: Home's data is one context per source, so a task change re-renders
// the task widgets only.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";
import { memo } from "react";

import {
  DashboardSources,
  loadedSource,
  makeMockDashboardData,
  useDashboardSource,
} from "./dashboard-data-context";

afterEach(cleanup);

describe("Home's data per source (TS-3b)", () => {
  it("a task change re-renders a task reader, never an Email reader", () => {
    const draws = { tasks: 0, email: 0 };
    const TasksReader = memo(function TasksReader() {
      draws.tasks += useDashboardSource("tasks").data.tasks.length >= 0 ? 1 : 0;
      return null;
    });
    const EmailReader = memo(function EmailReader() {
      draws.email += useDashboardSource("email").data.accounts.length >= 0 ? 1 : 0;
      return null;
    });
    const base = makeMockDashboardData();
    const tree = (
      <>
        <TasksReader />
        <EmailReader />
      </>
    );
    const view = render(<DashboardSources value={base}>{tree}</DashboardSources>);
    expect(draws).toEqual({ tasks: 1, email: 1 });
    const next = {
      ...base,
      tasks: loadedSource({ ...base.tasks.data, tasks: [] }),
    };
    view.rerender(<DashboardSources value={next}>{tree}</DashboardSources>);
    expect(draws).toEqual({ tasks: 2, email: 1 });
  });
});
