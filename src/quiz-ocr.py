"""Read text rendered with Xueyin's per-page substitution font."""
import base64
import io
import json
import sys

from PIL import Image
from rapidocr_onnxruntime import RapidOCR


def main():
    payload = json.load(sys.stdin)
    images = payload.get("images", [])
    if not isinstance(images, list) or not 0 < len(images) <= 48:
        raise ValueError("Invalid image count")
    engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)
    output = []
    for item in images:
        if not isinstance(item, str) or len(item) > 350000:
            raise ValueError("Invalid image")
        raw = base64.b64decode(item, validate=True)
        image = Image.open(io.BytesIO(raw))
        if image.width > 1800 or image.height > 180 or image.width < 20:
            raise ValueError("Invalid image dimensions")
        result, _ = engine(image)
        lines = sorted(result or [], key=lambda line: (line[0][0][1], line[0][0][0]))
        output.append({"text": "".join(line[1] for line in lines),
                       "confidence": min((float(line[2]) for line in lines), default=0)})
    json.dump(output, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": type(exc).__name__}), file=sys.stdout)
        sys.exit(1)
