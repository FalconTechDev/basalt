---
title: "Front [[Matter]]"
aliases:
  - one
  - "[[Alias Link]]"
tags: [x, y]
related: [[Wiki In YAML]]
link: "[[Real Link|shown]]"
md: "[text](note.md)"
md2: "[text](http://ext.com)"
md3: "[t](<a b.md> 'title')"
number: 42
float: 1.50
neg: -3
hex: 0x1F
oct: 0o17
yes: yes
bool: true
nul: ~
empty:
date: 2024-01-02
nested:
  key: "[[Nested Link]]"
  list:
    - "[[In List]]"
    - plain
  deep:
    deeper: "[txt](rel/path%20x.md)"
multi: |
  line one [[not matched]]
  line two
folded: >
  folded text
  more
"quoted key": value
1: one
2: two
anchor: &a
  x: 1
ref: *a
---
Body text with #bodytag and [[Body Link]].
