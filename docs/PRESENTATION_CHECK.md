# Product presentation checks

RoomFlow is presented as a meeting-room booking application for workplace teams, with an interactive presentation environment in English and Ukrainian.

## Validation

- 24 automated tests passed; client/server compilation and full TypeScript checks passed.
- 26 Chrome browser checks passed without JavaScript page errors.
- English is the default language. The language selector and stored preference were checked.
- Registration, verification pages, room names, sample meeting titles, forms, errors, history, empty states, and retry behavior were checked.
- Existing system feedback updates when switching between English and Ukrainian.
- Layouts were checked at 360, 390, 768, and 1440 pixels.
- The recorded walkthrough covers room search, booking, moving, and cancellation.
- The presentation page loads its images and 26.2-second video and supports both languages.

## Presentation materials

The package includes an English README with a Ukrainian counterpart, English screenshots, an MP4 walkthrough, an animated GIF, and a bilingual presentation page.

The language selector intentionally uses УК / Українська. User-entered content remains in its original language. Native browser controls may follow the browser or operating-system language.

## Test environment

Functional checks ran on Windows, Node 24.19.0, and Chrome. Node 22 and Docker are configured but were not exercised in these checks. Dependency versions remain as recorded in package-lock.json; the dependency audit reported three moderate affected packages, including one runtime dependency.

## Running a presentation

1. Start the application and select EN before sharing the screen.
2. Use the sample accounts and choose a future booking time.
3. Keep the included MP4 available for an offline walkthrough.
4. Verify the actual hosted URL after deployment.

The supplied environment uses demonstration accounts and sample data. Deployment requirements are documented in the README.
