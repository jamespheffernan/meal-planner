"""Single-link Sweeper adapter. No WhatsApp reads, digest run or browser cookies."""
import dataclasses
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit, urlunsplit
import re

DEFAULT_SWEEPER = '/Users/jamesheffernan/GitHub/General Knowledge Work/projects/manon-chat-sweeper/pilot.py'


def validate_url(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or parsed.hostname not in ('instagram.com', 'www.instagram.com')
            or parsed.username or parsed.password or parsed.port
            or not re.fullmatch(r'/(p|reel|tv)/[A-Za-z0-9_-]+/?', parsed.path)):
        raise ValueError('Use a single Instagram post or reel HTTPS link.')
    return urlunsplit(('https', parsed.netloc, parsed.path, '', ''))


def inspect(value):
    url = validate_url(value)
    source = Path(os.environ.get('MANON_SWEEPER_PATH', DEFAULT_SWEEPER))
    if source.is_dir():
        source = source / 'pilot.py'
    if not source.is_file():
        return {'evidence': [], 'gaps': ['Sweeper extractor not found. Set MANON_SWEEPER_PATH to pilot.py or paste recipe evidence.']}
    spec = importlib.util.spec_from_file_location('pi_meals_sweeper', source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    # Bound Sweeper's fixed tool calls, retaining its caption/speech/OCR implementation.
    def bounded_command(argv, *, timeout=60):
        if not argv or Path(argv[0]).name not in ('yt-dlp', 'ffmpeg', 'tesseract', 'whisper'):
            raise module.PilotError('Unsupported Sweeper extraction tool')
        if Path(argv[0]).name == 'yt-dlp':
            argv = [*argv, '--max-filesize', '30M', '--socket-timeout', '15', '--retries', '0', '--no-playlist']
        try:
            with tempfile.TemporaryFile(dir=root) as output, tempfile.TemporaryFile(dir=root) as errors:
                proc = subprocess.Popen(argv, stdout=output, stderr=errors, shell=False)
                deadline = time.monotonic() + min(timeout, 60)
                while proc.poll() is None:
                    if time.monotonic() >= deadline or os.fstat(output.fileno()).st_size > 1_048_576 or os.fstat(errors.fileno()).st_size > 131_072:
                        proc.kill()
                        proc.wait()
                        raise module.PilotError('Extraction tool exceeded timeout/output limit: ' + Path(argv[0]).name)
                    time.sleep(0.05)
                if os.fstat(output.fileno()).st_size > 1_048_576 or os.fstat(errors.fileno()).st_size > 131_072:
                    raise module.PilotError('Extraction tool exceeded output limit: ' + Path(argv[0]).name)
                output.seek(0)
                errors.seek(0)
                return subprocess.CompletedProcess(argv, proc.returncode, output.read().decode('utf-8', errors='replace'), errors.read().decode('utf-8', errors='replace'))
        except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
            raise module.PilotError('Extraction tool unavailable or timed out: ' + Path(argv[0]).name) from exc
    module.run_command = bounded_command
    root = Path(os.environ.get('PI_MEALS_WORK_DIR', '/Volumes/4TB Private/Offloaded/Agent Work/pi-meals-20261007/instagram-work'))
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='single-link-', dir=root) as folder:
        result = module.inspect_instagram_url(url, Path(folder), None, download_media=True)
        # Reuse Sweeper's recipe classifier as well as evidence extraction. TS retains raw evidence.
        recipe = module.recipe_from_evidence(result.evidence)
        gaps = list(result.media_context.get('extraction_gaps', []))
        if result.error:
            gaps.append('Instagram access/extraction: ' + result.error[:600])
        if not result.evidence:
            gaps.append('No recipe evidence retrieved. Paste caption, speech or on-screen text to continue.')
        mapping = {'caption': 'caption', 'spoken instructions': 'speech', 'on-screen text': 'ocr'}
        evidence = [{'source': mapping.get(line.source, 'caption'), 'text': line.text} for line in result.evidence]
        if sum(len(line['text']) for line in evidence) > 128_000:
            return {'evidence': [], 'gaps': ['Instagram evidence too large. Paste the recipe text.']}
        return {'evidence': evidence, 'gaps': list(dict.fromkeys(gaps)), 'recipe': recipe}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Exactly one Instagram link is required.')
        print(json.dumps(inspect(sys.argv[1])))
    except Exception as exc:
        print(json.dumps({'evidence': [], 'gaps': ['Instagram extractor unavailable: ' + str(exc)[:600] + '. Paste recipe evidence to continue.']}))
