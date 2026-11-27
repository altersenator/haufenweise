# Haufenweise

Eine gemeinnützige App, mit der Privathaushalte Dinge verschenken, die sonst auf dem Sperrmüll landen würden.
Jeder baut aus seinen Gegenständen einen virtuellen 3D-Haufen, andere stöbern darin und holen ab.

Das ausführliche Konzept liegt als Dokument bei Claude.

Die aktuelle Version läuft unter **https://altersenator.github.io/haufenweise/** und wird bei jeder Änderung an `main` automatisch neu veröffentlicht (`.github/workflows/deploy.yml`).

## Stand: Etappe 1, Gegenstände erfassen

- **Scan-Modus:** Live-Kamera, Rahmen um die sichtbare Seite (aus der Freistell-Maske, `src/lib/detect.ts`), automatisches Foto bei ruhigem, frontalem Bild, Seitenzuordnung über Kompass und Neigung (`src/lib/orientation.ts`)
- Alternativ Rundum-Video mit vorgeschlagenen Standbildern oder Einzelfotos
- Ecken jeder Seite markieren, Perspektive entzerren (`src/lib/perspective.ts`)

- Foto aufnehmen oder aus der Galerie wählen
- Hintergrund wird direkt auf dem Gerät entfernt (kein Upload)
- Titel, Zustand, Beschreibung und Maße (Breite, Höhe, Tiefe in cm) eintragen
- Vorschau als Quader in echten Proportionen, Foto auf der Vorderseite
- Größenvergleich aller Gegenstände im selben Maßstab, mit einer 170 cm großen Person
- Speichern, bearbeiten und löschen, vorerst nur lokal im Browser (IndexedDB)

## Stand: Etappe 2, den eigenen Haufen bauen

- 3D-Ansicht mit React Three Fiber, Physik mit Rapier (`src/heap/`)
- Jeder Gegenstand ist ein Quader in echter Größe, die entzerrten Fotos liegen auf den Seiten
- Aus der Ablage hinzufügen (sucht sich einen freien Platz), mit dem Finger ziehen und stapeln, drehen, kippen, festsetzen, herausnehmen
- Ziehen per Zielstrahl (Rapier-Raycast): Der Gegenstand landet dort, wo der Finger hinzeigt, auch in Regalfächern; beim Ziehen ist er ein Sensor und schiebt nichts an
- Deko-Bausteine (`src/heap/decos.ts`): Regal 4 × 4, Siegertreppchen, Schaukel mit Drehgelenk, Etagere; Größe per Regler, aus einfachen Teilen für Grafik und Physik zugleich
- Aufhängen an Haken per Seilgelenk (`src/heap/Rope.tsx`)
- Hintergründe (`src/heap/scenes.tsx`): freie Fläche, Polizeifoto-Wand mit Messlatte in echten Zentimetern und Blitz, Drehteller (kinematischer Körper, Tempo einstellbar)
- Die Aufstellung wird lokal gespeichert (IndexedDB, Store `heaps`)
- Der 3D-Teil wird erst beim Öffnen geladen (eigener Chunk, etwa 1,1 MB komprimiert)

## Technik

| Teil | Lösung |
| --- | --- |
| Oberfläche | React 19, TypeScript, Vite |
| Freistellen | U²-Netp (`tools/u2netp.onnx`, 4,5 MB, für das Hosting als `public/models/u2netp.json` verpackt) mit onnxruntime-web (WASM, ein Thread) |
| Speicher | IndexedDB, Fallback auf Arbeitsspeicher (`src/lib/storage.ts`) |

Wichtige Dateien

- `src/lib/backgroundRemoval.ts` Vorverarbeitung, Modellaufruf, Maske, Zuschnitt
- `src/components/ItemEditor.tsx` Ablauf zum Erfassen und Bearbeiten
- `src/components/BodyPreview.tsx` CSS-3D-Quader als Vorschau auf Etappe 2
- `src/components/SizeComparison.tsx` Größenvergleich im gemeinsamen Maßstab

## Lizenzen der Bausteine

- U²-Net / U²-Netp, Apache-2.0 ([xuebinqin/U-2-Net](https://github.com/xuebinqin/U-2-Net)); die ONNX-Datei stammt aus den Releases von [danielgatis/rembg](https://github.com/danielgatis/rembg)
- onnxruntime-web, MIT
- React, MIT

## Entwickeln

```bash
npm install
npm run dev      # Entwicklungsserver
npm run build    # fertige Dateien in dist/
```

## Bewusst noch offen (für die Prüfer)

- Noch kein Server, keine Anmeldung, keine Synchronisierung. Kommt in Etappe 3 mit Supabase.
- Die Maße werden geprüft (1 bis 1000 cm), Texte auf 60 bzw. 500 Zeichen begrenzt.
- Fotos werden über eine Canvas neu gezeichnet, dadurch fallen EXIF-Daten inklusive GPS weg.
- Das Modell ist klein und schnell, aber nicht perfekt. Bei unruhigem Hintergrund kann man aufs Originalfoto ausweichen.
