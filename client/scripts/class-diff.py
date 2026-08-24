#!/usr/bin/env python3
"""Fail on Tailwind classes that the theme never generates.

A class whose colour/size name is missing from `@theme` produces no CSS at all.
Nothing errors, the element just renders unstyled, so these are invisible in
review and easy to reintroduce. Run after `npm run build`, from `client/`.

Exit status is the number of unresolved instances (0 = clean).
"""

import collections
import glob
import re
import sys

# Prefixes worth checking: the utilities that take a theme name.
UTILITY = re.compile(
    r"^(bg|text|border|ring|shadow|fill|stroke|from|to|via|divide|outline|placeholder"
    r"|duration|ease)-[a-z]"
)
# Tokens that look like utilities but aren't: SVG pattern ids, CSS keywords.
IGNORE = {"bg-minor", "bg-major", "border-box", "text-balance", "text-pretty",
          "text-left", "text-center", "text-right", "text-clip", "text-ellipsis",
          "text-wrap", "text-nowrap", "border-solid", "border-dashed",
          "border-inherit", "border-transparent", "border-current",
          "bg-transparent", "bg-current", "bg-clip-padding", "bg-clip-border",
          "bg-blend-color", "bg-none", "bg-cover", "bg-contain", "bg-center",
          "bg-no-repeat", "shadow-none", "ring-inset", "outline-none",
          "outline-hidden", "outline-dashed", "outline-solid", "ease-linear",
          "ease-initial", "fill-none", "stroke-none", "stroke-width",
          "stroke-dasharray", "stroke-dashoffset"}
SPECIAL = "[]()./,%#!:*&>=+$?|~^'\"@"

# --- style guidelines (ui/README.md) -------------------------------------
# The design-system layer is held to the README; the rest of the app is only
# reported, so this gate can land without rewriting unrelated screens.
GOVERNED = "src/components/ui/"

# Popup containers and menu items may suppress the outline: a background
# highlight already signals focus. Keyed by file, per the README's exception.
OUTLINE_EXEMPT = {
    "alert-dialog.tsx", "dialog.tsx", "popover.tsx", "sheet.tsx",
    "context-menu.tsx", "dropdown-menu.tsx", "tooltip.tsx",
}
# The raw palette is a section-2 primitive; components use semantic names.
PALETTE = re.compile(r"^(bg|text|border|ring|fill|stroke|divide)-(stone|white|black)(-\d+)?$")
COLOUR_UTILITY = re.compile(r"^(bg|text|border|ring|fill|stroke|divide|outline)-[a-z]")


def guideline_violations(path: str, literal: str):
    """Yield (rule, token) for each README violation in one class literal."""
    name = path.rsplit("/", 1)[-1]
    for token in literal.split():
        bare = token.split(":")[-1].lstrip("!")
        variants = token.split(":")[:-1]

        if any(v == "focus-visible" for v in variants) and bare.startswith("ring"):
            yield "focus-ring", token
        if bare in ("outline-none", "outline-hidden") and name not in OUTLINE_EXEMPT:
            yield "outline-suppressed", token
        if bare.startswith("ring-offset-") and not re.match(
            r"^ring-offset-\d+$", bare
        ):
            continue  # an explicit offset *colour* is what makes it safe
        if re.match(r"^ring-offset-\d+$", bare) and not re.search(
            r"ring-offset-(?!\d)[a-z]", literal
        ):
            yield "ring-offset-no-colour", token
        if PALETTE.match(bare):
            yield "raw-palette", token
        if any(v == "dark" for v in variants) and COLOUR_UTILITY.match(bare):
            yield "dark-colour-fork", token


def css_escape(name: str) -> str:
    """Mirror how Tailwind escapes a class name into a selector."""
    return "".join("\\" + c if c in SPECIAL else c for c in name)


def main() -> int:
    sheets = glob.glob("dist/assets/index-*.css")
    if not sheets:
        print("no dist/assets/index-*.css — run `npm run build` first")
        return 1
    css = open(sheets[0]).read()

    missing = collections.Counter()
    where = collections.defaultdict(set)
    governed = collections.defaultdict(list)
    ungoverned = collections.Counter()

    for path in sorted(glob.glob("src/**/*.tsx", recursive=True)):
        source = open(path).read()
        literals = re.findall(r'"([^"\n]{3,})"', source)
        literals += re.findall(r"'([^'\n]{3,})'", source)
        for literal in literals:
            for rule, token in guideline_violations(path, literal):
                if path.startswith(GOVERNED):
                    governed[rule].append((path.replace(GOVERNED, ""), token))
                else:
                    ungoverned[rule] += 1
            for token in literal.split():
                # Drop variant prefixes (`hover:`, `dark:`, `data-[x=y]:`).
                name = token.split(":")[-1].lstrip("!")
                if name in IGNORE or not UTILITY.match(name):
                    continue
                # Match the name as the final segment of any selector.
                pattern = r"[.\\:]" + re.escape(css_escape(name)) + r"(?=[{,\s:>~+\[])"
                if not re.search(pattern, css):
                    missing[name] += 1
                    where[name].add(path.replace("src/", ""))

    total = sum(missing.values())
    print(f"UNRESOLVED: {total} instances / {len(missing)} distinct")
    for name, count in missing.most_common():
        print(f"{count:5}  {name:34} {', '.join(sorted(where[name])[:3])}")

    breaches = sum(len(v) for v in governed.values())
    print(f"GUIDELINE VIOLATIONS ({GOVERNED}): {breaches}")
    for rule in sorted(governed):
        for where_, token in governed[rule]:
            print(f"       {rule:22} {where_:22} {token}")

    if ungoverned:
        outside = sum(ungoverned.values())
        print(f"\nnote: {outside} same-rule violations outside {GOVERNED} "
              f"(reported, not enforced):")
        for rule, count in ungoverned.most_common():
            print(f"       {rule:22} {count}")

    return total + breaches


if __name__ == "__main__":
    sys.exit(main())
