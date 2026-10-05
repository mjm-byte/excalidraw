import { KEYS } from "@excalidraw/common";

import { isTextElement } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { t } from "../i18n";

const WORD_REGEX = /[\p{L}\p{N}_'-]+/gu;
const TRAILING_WORD_REGEX = /[\p{L}\p{N}_'-]+$/u;
const LEADING_WORD_CHAR_REGEX = /^[\p{L}\p{N}_'-]/u;

/** the shortest word worth suggesting */
const MIN_WORD_LENGTH = 4;
/** how much of a word must be typed before suggestions show */
const MIN_PREFIX_LENGTH = 2;
const MAX_SUGGESTIONS = 5;
/** the gap between the caret's line and the list, in px */
const CARET_GAP = 6;
const EDGE_GAP = 8;

export type TextAutocompleteWord = {
  word: string;
  count: number;
};

/**
 * The words used in the text of the scene, most used first. `excludeId` is
 * the text being edited, whose words are the ones being typed.
 */
export const getSceneWords = (
  elements: readonly ExcalidrawElement[],
  excludeId?: string,
): TextAutocompleteWord[] => {
  // lowercased word -> casings seen
  const words = new Map<string, Map<string, number>>();

  for (const element of elements) {
    if (!isTextElement(element) || element.id === excludeId) {
      continue;
    }
    for (const [word] of element.originalText.matchAll(WORD_REGEX)) {
      if (word.length < MIN_WORD_LENGTH) {
        continue;
      }
      const key = word.toLowerCase();
      const casings = words.get(key) ?? new Map<string, number>();
      casings.set(word, (casings.get(word) ?? 0) + 1);
      words.set(key, casings);
    }
  }

  return [...words.values()]
    .map((casings) => {
      const sorted = [...casings].sort((a, b) => b[1] - a[1]);
      return {
        word: sorted[0][0],
        count: sorted.reduce((total, [, count]) => total + count, 0),
      };
    })
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
};

/**
 * The words that go on from `prefix`, as they'd read after it (the caller's
 * casing of the prefix is kept).
 */
export const getSuggestions = (
  words: readonly TextAutocompleteWord[],
  prefix: string,
  limit = MAX_SUGGESTIONS,
) => {
  if (prefix.length < MIN_PREFIX_LENGTH) {
    return [];
  }
  const lowerPrefix = prefix.toLowerCase();
  const suggestions: string[] = [];
  for (const { word } of words) {
    if (
      word.length > prefix.length &&
      word.toLowerCase().startsWith(lowerPrefix)
    ) {
      suggestions.push(prefix + word.slice(prefix.length));
      if (suggestions.length === limit) {
        break;
      }
    }
  }
  return suggestions;
};

type CaretBounds = { left: number; bottom: number; top: number };

export type TextAutocomplete = {
  /** to call when the text changed (`fromInput`) or the caret may have moved */
  update: (fromInput?: boolean) => void;
  /** places the list at the caret again, e.g. after the canvas panned */
  reposition: () => void;
  /** true if the key was taken by the list */
  handleKeyDown: (event: KeyboardEvent) => boolean;
  isOpen: () => boolean;
  destroy: () => void;
};

/**
 * Suggests, in a list at the caret, words from the scene that go on from the
 * word being typed in `editable`. Tab takes the highlighted one; arrow keys
 * move through the list (and Enter takes the one arrowed to); Escape closes it.
 */
export const createTextAutocomplete = ({
  editable,
  container,
  getWords,
  getCaretBounds,
  getContainerLeft,
}: {
  editable: HTMLTextAreaElement;
  container: HTMLElement;
  getWords: () => readonly TextAutocompleteWord[];
  /** the caret's line, relative to the canvas */
  getCaretBounds: () => CaretBounds | null;
  /** how far in the container's left edge is from the canvas' */
  getContainerLeft: () => number;
}): TextAutocomplete => {
  const ownerDocument = editable.ownerDocument;
  const listId = `excalidraw-text-autocomplete-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  let words: readonly TextAutocompleteWord[] | null = null;
  let suggestions: string[] = [];
  let prefix = "";
  let selected = 0;
  // Enter takes a suggestion only once it was picked with the arrow keys, so
  // that it keeps breaking the line after a word that happens to start others
  let navigated = false;
  let isComposing = false;
  let lastState = "";
  let list: HTMLDivElement | null = null;

  const getState = () =>
    `${editable.value}\u0000${editable.selectionStart}\u0000${editable.selectionEnd}`;

  const getPrefix = () => {
    const { value, selectionStart, selectionEnd } = editable;
    if (
      selectionStart !== selectionEnd ||
      LEADING_WORD_CHAR_REGEX.test(value.slice(selectionStart))
    ) {
      return "";
    }
    return TRAILING_WORD_REGEX.exec(value.slice(0, selectionStart))?.[0] ?? "";
  };

  const close = () => {
    suggestions = [];
    selected = 0;
    navigated = false;
    if (list) {
      list.remove();
      list = null;
    }
    editable.removeAttribute("aria-expanded");
    editable.removeAttribute("aria-controls");
    editable.removeAttribute("aria-activedescendant");
  };

  const accept = (index: number) => {
    const suggestion = suggestions[index];
    if (!suggestion) {
      return;
    }
    const { value, selectionStart } = editable;
    const nextCaret = selectionStart + suggestion.length - prefix.length;
    editable.value =
      value.slice(0, selectionStart) +
      suggestion.slice(prefix.length) +
      value.slice(selectionStart);
    editable.setSelectionRange(nextCaret, nextCaret);
    close();
    // sizes the editor to the text, and lets the app know
    editable.dispatchEvent(new Event("input"));
    // the word's complete: nothing more to suggest until typing goes on
    lastState = getState();
  };

  const renderRows = () => {
    if (!list) {
      return;
    }
    list.replaceChildren();
    suggestions.forEach((suggestion, index) => {
      const row = ownerDocument.createElement("div");
      row.id = `${listId}-${index}`;
      row.className = "TextAutocomplete__item";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(index === selected));
      if (index === selected) {
        row.classList.add("is-selected");
        editable.setAttribute("aria-activedescendant", row.id);
      }
      const typed = ownerDocument.createElement("span");
      typed.className = "TextAutocomplete__typed";
      typed.textContent = suggestion.slice(0, prefix.length);
      row.append(typed, suggestion.slice(prefix.length));
      // keep the focus in the editor: blurring it would submit the text
      row.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      row.addEventListener("pointerup", (event) => {
        event.preventDefault();
        accept(index);
      });
      list!.append(row);
    });

    const hints = ownerDocument.createElement("div");
    hints.className = "TextAutocomplete__hints";
    [
      ["Tab", t("textAutocomplete.insert")],
      ["Esc", t("textAutocomplete.close")],
    ].forEach(([key, label]) => {
      const hint = ownerDocument.createElement("span");
      const kbd = ownerDocument.createElement("kbd");
      kbd.textContent = key;
      hint.append(kbd, label);
      hints.append(hint);
    });
    list.append(hints);
  };

  const reposition = () => {
    if (!list) {
      return;
    }
    const caret = getCaretBounds();
    if (!caret) {
      list.style.visibility = "hidden";
      return;
    }
    const containerLeft = getContainerLeft();
    const { offsetWidth, offsetHeight } = list;
    const left = Math.max(
      EDGE_GAP,
      Math.min(
        caret.left - containerLeft,
        container.clientWidth - offsetWidth - EDGE_GAP,
      ),
    );
    let top = caret.bottom + CARET_GAP;
    if (top + offsetHeight > container.clientHeight - EDGE_GAP) {
      // no room below: above the caret's line
      top = Math.max(EDGE_GAP, caret.top - CARET_GAP - offsetHeight);
    }
    list.style.left = `${left}px`;
    list.style.top = `${top}px`;
    list.style.visibility = "";
  };

  const update = (fromInput = false) => {
    const state = getState();
    if (!fromInput && (!list || state === lastState)) {
      return;
    }
    lastState = state;
    if (isComposing) {
      close();
      return;
    }

    prefix = getPrefix();
    words ??= getWords();
    const next = getSuggestions(words, prefix);
    if (!next.length) {
      close();
      return;
    }
    // the same list, the same pick
    if (next.join() !== suggestions.join()) {
      selected = 0;
      navigated = false;
    }
    suggestions = next;

    if (!list) {
      list = ownerDocument.createElement("div");
      list.className = "TextAutocomplete";
      list.id = listId;
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", t("textAutocomplete.label"));
      // clicks on the list's padding must not blur the editor either
      list.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      container.append(list);
      editable.setAttribute("aria-expanded", "true");
      editable.setAttribute("aria-controls", listId);
    }
    renderRows();
    reposition();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!list || event.isComposing) {
      return false;
    }
    const withModifier =
      event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;

    if (event.key === KEYS.ARROW_DOWN || event.key === KEYS.ARROW_UP) {
      if (withModifier) {
        return false;
      }
      const step = event.key === KEYS.ARROW_DOWN ? 1 : -1;
      selected = (selected + step + suggestions.length) % suggestions.length;
      navigated = true;
      renderRows();
      return true;
    }
    if (event.key === KEYS.TAB && !withModifier) {
      accept(selected);
      return true;
    }
    if (event.key === KEYS.ENTER && !withModifier && navigated) {
      accept(selected);
      return true;
    }
    if (event.key === KEYS.ESCAPE) {
      close();
      return true;
    }
    return false;
  };

  const onCompositionStart = () => {
    isComposing = true;
    close();
  };
  const onCompositionEnd = () => {
    isComposing = false;
  };
  const onCaretMoved = () => update();
  editable.setAttribute("aria-autocomplete", "list");
  editable.addEventListener("compositionstart", onCompositionStart);
  editable.addEventListener("compositionend", onCompositionEnd);
  editable.addEventListener("keyup", onCaretMoved);
  editable.addEventListener("pointerup", onCaretMoved);

  return {
    update,
    reposition,
    handleKeyDown,
    isOpen: () => !!list,
    destroy: () => {
      close();
      editable.removeAttribute("aria-autocomplete");
      editable.removeEventListener("compositionstart", onCompositionStart);
      editable.removeEventListener("compositionend", onCompositionEnd);
      editable.removeEventListener("keyup", onCaretMoved);
      editable.removeEventListener("pointerup", onCaretMoved);
    },
  };
};
