import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { Pointer, UI } from "../tests/helpers/ui";
import { getTextEditor, updateTextEditor } from "../tests/queries/dom";
import { fireEvent, render, unmountComponent } from "../tests/test-utils";

import { getSceneWords, getSuggestions } from "./textAutocomplete";

unmountComponent();

const mouse = new Pointer("mouse");

const LIST = ".TextAutocomplete";
const getItems = () =>
  [...document.querySelectorAll(`${LIST} .TextAutocomplete__item`)].map(
    (item) => item.textContent,
  );

describe("getSceneWords", () => {
  it("lists the words of other texts, most used first", () => {
    const elements = [
      API.createElement({
        type: "text",
        id: "a",
        text: "database architecture\nDatabase",
      }),
      API.createElement({
        type: "text",
        id: "b",
        text: "architecture a to be",
      }),
      API.createElement({ type: "text", id: "c", text: "ignored words here" }),
      API.createElement({ type: "rectangle" }),
    ];
    expect(getSceneWords(elements, "c").map(({ word }) => word)).toEqual([
      "architecture",
      "database",
    ]);
  });
});

describe("getSuggestions", () => {
  const words = ["database", "dashboard", "data", "Deployment"].map((word) => ({
    word,
    count: 1,
  }));

  it("needs two letters, matches ignoring case and keeps the typed ones", () => {
    expect(getSuggestions(words, "d")).toEqual([]);
    expect(getSuggestions(words, "da")).toEqual([
      "database",
      "dashboard",
      "data",
    ]);
    expect(getSuggestions(words, "DEP")).toEqual(["DEPloyment"]);
  });

  it("leaves out the word as typed", () => {
    expect(getSuggestions(words, "data")).toEqual(["database"]);
  });
});

describe("text autocomplete", () => {
  let textarea: HTMLTextAreaElement;

  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    // @ts-ignore
    window.h.app.refreshEditorInterface();
    const textElement = UI.createElement("text");
    API.setElements([
      ...window.h.elements,
      API.createElement({
        type: "text",
        text: "authentication and authorization",
        x: 400,
        y: 400,
      }),
    ]);
    mouse.clickOn(textElement);
    textarea = await getTextEditor();
  });

  const type = (value: string) => {
    updateTextEditor(textarea, value);
    textarea.setSelectionRange(value.length, value.length);
    fireEvent.input(textarea);
  };

  it("suggests words from the scene while typing", () => {
    type("auth");
    expect(getItems()).toEqual(["authentication", "authorization"]);

    type("x");
    expect(getItems()).toEqual([]);
  });

  it("inserts the highlighted word with Tab, instead of indenting", () => {
    type("an auth");
    fireEvent.keyDown(textarea, { key: KEYS.TAB });

    expect(textarea.value).toBe("an authentication");
    expect(textarea.selectionStart).toBe("an authentication".length);
    expect(document.querySelector(LIST)).toBe(null);
  });

  it("moves through the list with the arrow keys, and Enter inserts", () => {
    type("auth");
    fireEvent.keyDown(textarea, { key: KEYS.ARROW_DOWN });
    expect(
      document.querySelector(".TextAutocomplete__item.is-selected")
        ?.textContent,
    ).toBe("authorization");
    fireEvent.keyDown(textarea, { key: KEYS.ENTER });

    expect(textarea.value).toBe("authorization");
  });

  it("leaves Enter to the line break until the list was navigated", () => {
    type("auth");
    const notPrevented = fireEvent.keyDown(textarea, { key: KEYS.ENTER });

    expect(notPrevented).toBe(true);
    expect(textarea.value).toBe("auth");
  });

  it("closes with Escape without leaving the editor", async () => {
    type("auth");
    fireEvent.keyDown(textarea, { key: KEYS.ESCAPE });

    expect(document.querySelector(LIST)).toBe(null);
    expect(await getTextEditor({ waitForEditor: false })).toBe(textarea);
    expect(window.h.state.editingTextElement).not.toBeNull();

    // a second one leaves it
    fireEvent.keyDown(textarea, { key: KEYS.ESCAPE });
    expect(window.h.state.editingTextElement).toBeNull();
  });

  it("tab still indents when nothing is suggested", () => {
    type("xyz");
    fireEvent.keyDown(textarea, { key: KEYS.TAB });

    expect(textarea.value).toBe("    xyz");
  });

  it("doesn't suggest in the middle of a word", () => {
    type("auth");
    updateTextEditor(textarea, "authentication");
    textarea.setSelectionRange(4, 4);
    fireEvent.input(textarea);

    expect(getItems()).toEqual([]);
  });
});
