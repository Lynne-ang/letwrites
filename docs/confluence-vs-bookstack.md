# Confluence vs BookStack: data structures, and how the import maps one to the other

If you are migrating from Confluence, the single thing to understand is this: **Confluence lets pages
nest as deep as you like; BookStack has a fixed, shallow hierarchy.** Everything the importer does
(and every surprise you might see) comes from reconciling those two shapes. This doc explains the
difference, shows the exact mapping, and walks a real example.

## The two models, side by side

### Confluence
```
Site
└── Space                      (e.g. "Engineering Handbook")
    └── Page                   (the space has a tree of pages)
        └── Page               ← a page can have child pages
            └── Page           ← …which can have their own children
                └── …          ← arbitrary depth
```
- A **Space** holds a tree of **Pages**.
- A **Page** can have child pages, with **no depth limit**.
- Attachments (images, files) hang off pages. Pages carry labels, comments, restrictions.

### BookStack
```
Shelf            (optional, flat grouping of books — a book can sit on several shelves)
└── Book
    ├── Chapter  (optional)
    │   └── Page
    └── Page     (a page can live directly in a book, with no chapter)
```
- The content hierarchy is fixed and **at most three levels**: `Book ▸ Chapter ▸ Page`.
- **Pages do not nest.** A page lives in a book, or in a chapter inside a book. That is the deepest it goes.
- **Chapters do not nest**, and **books do not nest**.
- **Shelves** are a flat, separate grouping layer *above* books (think "categories"). They are not a
  deeper nesting level, and one book can appear on multiple shelves.

### The core difference in one line
> Confluence is an **arbitrary-depth tree**. BookStack is a **fixed `Book ▸ Chapter ▸ Page`**. Migrating
> means flattening the deep parts of the tree into those three levels — without losing any page body.

## How the importer maps Confluence → BookStack

The planner walks every Confluence page, computes its depth in the space tree, and applies these rules
(see `exporter/src/import-planner.ts`):

| Confluence page | Becomes in BookStack |
|---|---|
| depth 0 (top-level page in the space) | a **Book** (plus a Page holding that page's own body) |
| depth 1, **has** children | a **Chapter** (plus a Page for its own body) |
| depth 1, **no** children | a **Page** directly in the Book |
| depth ≥ 2 | a **Page** in the nearest Chapter (or the Book if there is no chapter) |
| depth > 2 | **flattened** into that Chapter as a Page; the original nesting path is preserved as a breadcrumb note |

Two guarantees that matter:
- **No page body is ever dropped.** Even a page 6 levels deep keeps its full content; it just lands as
  a Page under the nearest chapter.
- **Flattening is reported, not hidden.** The migration integrity report counts how many pages had to
  be flattened and notes where each came from, so you can decide whether to reorganize afterward.

Other pieces:
- **Images/attachments** embedded in pages are uploaded to BookStack and rewritten to point at the new
  location. The report shows `imagesUploaded` and any `imagesMissing` (attachments referenced but not
  present in the export).
- **Shelves are not auto-created.** The importer produces books/chapters/pages. If you want shelves to
  group your imported books, add them in BookStack afterward (Shelves ▸ Create) — it is a one-time,
  drag-and-drop grouping.
- **Permissions/restrictions** do not carry over from Confluence. You set who-can-see in BookStack
  (per book/chapter/page), which is what the "Who can see this?" control is for.

## A worked example

A Confluence space "Engineering Handbook" shaped like this:

```
Engineering Handbook            (space home, depth 0)
├── Onboarding                  (depth 1, has children)
│   ├── Dev Environment         (depth 2)
│   │   └── macOS Setup         (depth 3)
│   └── Accounts & Access       (depth 2)
├── Architecture                (depth 1, has children)
│   └── Services                (depth 2)
│       └── Auth Service        (depth 3)
└── Coding Standards            (depth 1, no children)
```

imports into BookStack as:

```
Engineering Handbook                         (Book)
│   • Page "Engineering Handbook"            ← the space home's own body
├── Onboarding                               (Chapter)      ← depth-1 page WITH children
│   • Page "Onboarding"                      ← its own body
│   • Page "Dev Environment"                 ← depth 2
│   • Page "macOS Setup"                     ← depth 3, FLATTENED (note: "was under Dev Environment")
│   • Page "Accounts & Access"               ← depth 2
├── Architecture                             (Chapter)      ← depth-1 page WITH children
│   • Page "Architecture"                    ← its own body
│   • Page "Services"                        ← depth 2
│   • Page "Auth Service"                    ← depth 3, FLATTENED (note: "was under Services")
└── Page "Coding Standards"                  ← depth-1 page with NO children → a Page in the Book
```

The integrity report for this import would read something like:
`1 book, 2 chapters, 7 pages, 2 flattened`. The two flattened pages (macOS Setup, Auth Service) keep
their full content and a breadcrumb of where they used to live.

## Practical advice before you import

- **Deep spaces flatten the most.** If a Confluence space is very deep (4+ levels in places), expect a
  higher "flattened" count. The content is safe; it just sits flatter. You can re-nest into new
  chapters afterward in BookStack.
- **One big space → consider several books.** BookStack reads best when a Book is a coherent topic. If
  a single Confluence space really holds several unrelated topics, it is often nicer to import and
  then split it into multiple books (or import sections separately into existing books).
- **You don't need admin to import into an existing book.** The self-service import runs with *your*
  permissions — pick an existing book/space you can edit as the destination and the pages nest under
  it, no "Create Books" right required.
