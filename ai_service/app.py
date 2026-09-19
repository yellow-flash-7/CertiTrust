from flask import Flask, request, jsonify
import base64, io, os, tempfile
import numpy as np
import cv2
from PIL import Image

try:
    import fitz
except Exception:
    fitz = None

app = Flask(__name__)


def render_document(data, filename):
    ext = os.path.splitext(filename.lower())[1]
    if ext == '.pdf':
        if fitz is None:
            raise RuntimeError('PyMuPDF is required for PDF analysis.')
        doc = fitz.open(stream=data, filetype='pdf')
        page = doc[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(1.7, 1.7), alpha=False)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError('Unable to decode image.')
    return img


def align_pair(a, b):
    target_w = min(a.shape[1], b.shape[1])
    target_h = min(a.shape[0], b.shape[0])
    scale_a = target_w / a.shape[1]
    scale_b = target_w / b.shape[1]
    if scale_a != 1:
        a = cv2.resize(a, (target_w, max(1, int(a.shape[0]*scale_a))))
    if scale_b != 1:
        b = cv2.resize(b, (target_w, max(1, int(b.shape[0]*scale_b))))
    h = min(a.shape[0], b.shape[0])
    a, b = a[:h, :target_w], b[:h, :target_w]

    # Feature-based alignment makes small scan/print shifts less likely to become false positives.
    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    orb = cv2.ORB_create(nfeatures=2500)
    k1, d1 = orb.detectAndCompute(ga, None)
    k2, d2 = orb.detectAndCompute(gb, None)
    if d1 is not None and d2 is not None and len(k1) >= 8 and len(k2) >= 8:
        matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
        matches = matcher.knnMatch(d1, d2, k=2)
        good = [m for m,n in matches if m.distance < 0.72*n.distance]
        if len(good) >= 8:
            src = np.float32([k1[m.queryIdx].pt for m in good]).reshape(-1,1,2)
            dst = np.float32([k2[m.trainIdx].pt for m in good]).reshape(-1,1,2)
            H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
            if H is not None:
                a = cv2.warpPerspective(a, H, (b.shape[1], b.shape[0]))
    return a, b


def analyze(original, uploaded):
    a, b = align_pair(original, uploaded)
    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    diff = cv2.absdiff(ga, gb)
    # Suppress tiny scan/compression noise; retain meaningful changed text regions.
    diff = cv2.GaussianBlur(diff, (5,5), 0)
    threshold = max(22, int(np.percentile(diff, 97)))
    mask = (diff >= threshold).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5,5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.dilate(mask, np.ones((5,5), np.uint8), iterations=2)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    h, w = gb.shape
    for c in contours:
        x,y,bw,bh = cv2.boundingRect(c)
        area = bw*bh
        # Ignore tiny noise and huge page-wide differences.
        if area < 80 or area > 0.15*w*h:
            continue
        boxes.append((x,y,bw,bh,area))
    boxes.sort(key=lambda z: z[4], reverse=True)
    boxes = boxes[:12]

    annotated = b.copy()
    for i,(x,y,bw,bh,area) in enumerate(boxes,1):
        cv2.rectangle(annotated, (x,y), (x+bw,y+bh), (0,0,255), 4)
        cv2.putText(annotated, f'Change {i}', (x, max(24,y-8)), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0,0,255), 2, cv2.LINE_AA)

    # A practical confidence score for this visual-comparison engine, not a legal/absolute authenticity probability.
    changed_ratio = float(np.count_nonzero(mask)) / float(mask.size)
    confidence = int(max(50, min(99, 70 + min(29, changed_ratio * 1000)))) if boxes else 96
    risk = 'HIGH' if boxes else 'LOW'
    result = 'POSSIBLE_TAMPERING' if boxes else 'NO_VISUAL_DIFFERENCE_DETECTED'

    ok, enc = cv2.imencode('.jpg', annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    if not ok:
        raise RuntimeError('Could not encode annotated image.')
    return {
        'status': 'OK',
        'result': result,
        'risk': risk,
        'confidence': confidence,
        'changedRegions': [{'x':x,'y':y,'width':bw,'height':bh,'area':area} for x,y,bw,bh,area in boxes],
        'annotatedImage': 'data:image/jpeg;base64,' + base64.b64encode(enc.tobytes()).decode('ascii'),
        'message': 'Visual differences were localized and highlighted.' if boxes else 'No significant visual difference was detected.'
    }


@app.get('/health')
def health():
    return jsonify({'status':'OK','service':'CertiTrust AI document analysis'})


@app.post('/analyze')
def analyze_route():
    original = request.files.get('original')
    uploaded = request.files.get('uploaded')
    if not original or not uploaded:
        return jsonify({'message':'Both original and uploaded files are required.'}), 400
    try:
        a = render_document(original.read(), original.filename or 'original')
        b = render_document(uploaded.read(), uploaded.filename or 'uploaded')
        return jsonify(analyze(a,b))
    except Exception as e:
        return jsonify({'status':'ERROR','message':str(e)}), 500


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.getenv('AI_PORT','8000')), debug=False)
