# Bugfix Requirements Document

## Introduction

Two related rendering bugs affect the Simulate tab (tab index 7) and the D3GraphEngine visualizer used throughout the app.

**Bug 1 — Simulate Tab: Loose/Broken Graph Layout**
When the Simulate tab is opened, the `.sim-graph-col` container has no explicit height, so the `.gp-canvas` flex child cannot compute its height. As a result, `container.clientHeight` returns `0` or a very small value when `drawGraph` is called, causing the D3 SVG to be drawn with wrong dimensions and the graph to appear "loose" or invisible.

**Bug 2 — D3GraphEngine: Rendering Issues**
The `drawGraph` function in `D3GraphEngine.js` has several issues that make it unsuitable as a step-by-step visualizer: transition arrows are missing or invisible on first render, transition labels overlap each other, and node spacing is incorrect on the first render pass. These issues affect ε-NFA, NFA, and DFA graphs in the Simulate tab.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the Simulate tab is opened and `drawGraph` is called, THEN the system reads `container.clientHeight` as `0` or near-zero because `.sim-graph-col` has no explicit height, causing the SVG to be rendered with incorrect dimensions

1.2 WHEN `drawGraph` renders a graph with no saved positions and `clientHeight` is `0`, THEN the system places all nodes at `y = 0` (or near-zero), producing a collapsed, unreadable layout on first render

1.3 WHEN `drawGraph` computes edge paths immediately after placing nodes, THEN the system draws arrows that point to incorrect coordinates because node positions were computed using a zero or near-zero canvas height

1.4 WHEN multiple transitions exist between the same pair of states or between states that are close together, THEN the system renders transition labels at overlapping positions because `layoutEdgeLabels` places labels at the midpoint of the path without accounting for other labels at the same location

1.5 WHEN `drawGraph` is called and new edges are animated via `stroke-dasharray`/`stroke-dashoffset`, THEN the system sets `getTotalLength()` on paths that have not yet been painted to the DOM, returning `0` and causing the draw animation to produce invisible (zero-length) strokes — arrows never appear

1.6 WHEN `fitGraph(false)` is called synchronously after `updateScene()`, THEN the system computes bounding boxes before the browser has laid out the SVG, resulting in incorrect scale/translate values and a mispositioned graph on first render

### Expected Behavior (Correct)

2.1 WHEN the Simulate tab is opened and `drawGraph` is called, THEN the system SHALL use a non-zero canvas height (falling back to a sensible default such as `600` when `clientHeight` is `0`) so the SVG is rendered with correct dimensions

2.2 WHEN `drawGraph` renders a graph with no saved positions and a valid canvas height, THEN the system SHALL distribute nodes across the full height of the canvas so the layout is readable on first render without requiring a zoom/fit pass

2.3 WHEN `drawGraph` computes edge paths, THEN the system SHALL use the correct node coordinates so all arrows point to the right source and target nodes

2.4 WHEN multiple transition labels would overlap at the same position, THEN the system SHALL offset each label so that no two labels for different edges occupy the same screen coordinates

2.5 WHEN `drawGraph` animates new edges, THEN the system SHALL defer reading `getTotalLength()` until after the browser has painted the paths (e.g. via `requestAnimationFrame` or a short `setTimeout`), so the animation produces visible strokes and arrows appear correctly

2.6 WHEN `fitGraph` is called on first render, THEN the system SHALL defer the call until after the browser has completed layout (e.g. via `requestAnimationFrame`), so bounding boxes are accurate and the graph is correctly scaled and centered

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the graph is rendered on tabs other than Simulate (ε-NFA Build Steps, Full ε-NFA, Reduced NFA, NFA→DFA Steps, Full DFA, Minimized DFA), THEN the system SHALL CONTINUE TO display the graph with the same visual appearance and layout behavior as before

3.2 WHEN a user drags a node and the position is saved to `graphPositionStore`, THEN the system SHALL CONTINUE TO restore those saved positions on subsequent renders of the same graph signature

3.3 WHEN `drawGraph` is called with `highlightStates` containing active state IDs, THEN the system SHALL CONTINUE TO dim non-highlighted nodes and edges and raise highlighted nodes to the foreground

3.4 WHEN `drawGraph` is called with `new_states` or `new_transitions` in the data, THEN the system SHALL CONTINUE TO animate the appearance of new nodes and edges with the existing grow/draw animations

3.5 WHEN the browser window is resized and the `ResizeObserver` in `GraphPanel` fires, THEN the system SHALL CONTINUE TO redraw the graph to fit the new container dimensions

3.6 WHEN the Simulate tab graph is rendered, THEN the system SHALL NOT change any UI colors, typography, or layout structure outside of `.sim-graph-col` height and `D3GraphEngine` rendering logic
