# Compiler Question Queue Boundaries

The compiler question queue is a structured inventory of missing executable
module decisions and their exact source evidence. It is not an error log, and
an open or unknown question is a valid, honest compiler state.

Questions are generated deterministically from draft scenes, draft clues,
unresolved marked items, and prose structure. They ask about scene roles,
entry, topology, core clues, endings, discovery methods, and item bindings;
they do not answer those questions. In particular, headings do not become an
entry, document order does not become a connection, and marked items do not
become core clues.

Every question hashes its document identity, kind, source statement IDs, and
role. Its evidence refs must cover the cited SourceStatements. Draft readiness
links each blocking code to one or more open, publish-blocking questions while
remaining `draft_only`.

`ModuleCompileHints` is an in-memory validation contract for future explicit
answers. A hint must match queue identity, question kind, exact source evidence,
and allowed authority/reviewer values; duplicate resolutions and dangling IDs
fail closed. P6 does not read hint files or turn hints into interpretations.
P7 may consume validated hints, while this queue remains evidence and gap
tracking only.
