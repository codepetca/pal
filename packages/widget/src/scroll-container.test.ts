import assert from "node:assert/strict";
import test from "node:test";

import {
  centerElementWithinScrollContainer,
  findNearestVerticalScrollContainer,
} from "./scroll-container";

type MockElement = {
  clientHeight: number;
  getBoundingClientRect: () => DOMRect;
  ownerDocument: MockDocument;
  parentElement: MockElement | null;
  scrollHeight: number;
  scrollTo: (options: ScrollToOptions) => void;
  scrollTop: number;
  style: { overflowY: string };
};

type MockDocument = {
  body: MockElement;
  defaultView: { getComputedStyle: (element: MockElement) => { overflowY: string } };
  documentElement: MockElement;
};

function rect(top: number, height: number): DOMRect {
  return { top, height } as DOMRect;
}

function createTree() {
  const document = {} as MockDocument;
  const element = (overflowY = "visible"): MockElement => ({
    clientHeight: 0,
    getBoundingClientRect: () => rect(0, 0),
    ownerDocument: document,
    parentElement: null,
    scrollHeight: 0,
    scrollTo() {},
    scrollTop: 0,
    style: { overflowY },
  });
  document.defaultView = {
    getComputedStyle: (candidate) => candidate.style,
  };
  document.body = element("auto");
  document.documentElement = element("auto");
  document.body.parentElement = document.documentElement;
  return { document, element };
}

test("finds the nearest explicit scrollport without selecting the page root", () => {
  const { document, element } = createTree();
  const scrollport = element("auto");
  const surface = element();
  const target = element();
  scrollport.parentElement = document.body;
  surface.parentElement = scrollport;
  target.parentElement = surface;

  assert.equal(
    findNearestVerticalScrollContainer(target as unknown as HTMLElement),
    scrollport,
  );

  scrollport.style.overflowY = "visible";
  assert.equal(
    findNearestVerticalScrollContainer(target as unknown as HTMLElement),
    null,
  );
});

test("centers within the scrollport and clamps to its scroll range", () => {
  const { element } = createTree();
  const calls: ScrollToOptions[] = [];
  const scrollport = element("auto");
  scrollport.clientHeight = 300;
  scrollport.scrollHeight = 1_000;
  scrollport.scrollTop = 100;
  scrollport.getBoundingClientRect = () => rect(50, 300);
  scrollport.scrollTo = (options) => calls.push(options);
  const target = element();
  target.getBoundingClientRect = () => rect(500, 100);

  centerElementWithinScrollContainer(
    target as unknown as HTMLElement,
    scrollport as unknown as HTMLElement,
    "smooth",
  );

  assert.deepEqual(calls, [{ behavior: "smooth", top: 450 }]);
});
