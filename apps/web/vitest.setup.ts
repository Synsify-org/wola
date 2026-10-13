import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// The default 1s for findBy*/waitFor is too tight when the whole suite runs in
// parallel on a busy machine (the first render of a heavy form can take longer);
// a real failure still fails, just a few seconds later.
configure({ asyncUtilTimeout: 4000 });
