"""Zone presence + line crossing per tracked object, with debouncing.

Generic only: "track 7 (person) entered zone 'gate'". Whether that is an alert is the
rules layer's decision.

Debouncing (avoids flicker from a single bad frame):
  * zone.enter fires once per (track, zone), after `confirm_frames` consecutive in-zone frames
  * zone.exit fires once the object has been out of the zone (or lost) for `exit_after_s`
  * line.cross fires on a side change; repeat crossings by the same track on the same
    line within `exit_after_s` are ignored (jitter on the line)
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .config import LineCfg, ZoneCfg


@dataclass
class TrackedObject:
    track_id: int
    class_name: str
    confidence: float
    bbox: np.ndarray  # normalised x1, y1, x2, y2


@dataclass
class ZoneState:
    consecutive: int = 0
    entered: bool = False
    first_in_ts: float = 0.0
    last_in_ts: float = 0.0
    last_obj: TrackedObject | None = None


@dataclass
class Transition:
    type: str  # zone.enter | zone.exit | line.cross
    obj: TrackedObject
    zone_id: str | None = None
    line_id: str | None = None
    direction: str | None = None
    dwell_s: float | None = None


def anchor_point(bbox: np.ndarray, anchor: str) -> tuple[float, float]:
    x1, y1, x2, y2 = bbox
    if anchor == "center":
        return (x1 + x2) / 2, (y1 + y2) / 2
    return (x1 + x2) / 2, y2  # bottom_center (feet)


def side_of_line(p, a, b) -> float:
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


@dataclass
class ZoneEngine:
    zones: list[ZoneCfg]
    lines: list[LineCfg]
    confirm_frames: int = 3
    exit_after_s: float = 3.0
    anchor: str = "bottom_center"
    _zone_state: dict[tuple[int, str], ZoneState] = field(default_factory=dict)
    _line_side: dict[tuple[int, str], float] = field(default_factory=dict)
    _line_last_cross: dict[tuple[int, str], float] = field(default_factory=dict)

    def __post_init__(self):
        self._polys = {z.id: np.array(z.polygon, dtype=np.float32).reshape(-1, 1, 2) for z in self.zones}

    def update(self, objects: list[TrackedObject], now: float) -> list[Transition]:
        out: list[Transition] = []
        seen: set[tuple[int, str]] = set()

        for obj in objects:
            p = anchor_point(obj.bbox, self.anchor)

            for zone_id, poly in self._polys.items():
                key = (obj.track_id, zone_id)
                inside = cv2.pointPolygonTest(poly, (float(p[0]), float(p[1])), False) >= 0
                if not inside:
                    continue
                seen.add(key)
                st = self._zone_state.setdefault(key, ZoneState(first_in_ts=now))
                if st.consecutive == 0 and not st.entered:
                    st.first_in_ts = now
                st.consecutive += 1
                st.last_in_ts = now
                st.last_obj = obj
                if not st.entered and st.consecutive >= self.confirm_frames:
                    st.entered = True
                    out.append(Transition("zone.enter", obj, zone_id=zone_id, dwell_s=now - st.first_in_ts))

            for line in self.lines:
                key = (obj.track_id, line.id)
                s = side_of_line(p, line.start, line.end)
                prev = self._line_side.get(key)
                self._line_side[key] = s
                if prev is None or s == 0 or (prev > 0) == (s > 0):
                    continue
                if now - self._line_last_cross.get(key, -1e9) < self.exit_after_s:
                    continue
                self._line_last_cross[key] = now
                out.append(Transition("line.cross", obj, line_id=line.id, direction="in" if s > 0 else "out"))

        # Objects not in a zone this frame: reset streak; exit after grace period.
        for key, st in list(self._zone_state.items()):
            if key in seen:
                continue
            st.consecutive = 0
            if now - st.last_in_ts >= self.exit_after_s:
                if st.entered and st.last_obj is not None:
                    out.append(
                        Transition("zone.exit", st.last_obj, zone_id=key[1], dwell_s=st.last_in_ts - st.first_in_ts)
                    )
                del self._zone_state[key]

        # Forget line state for tracks gone for a long time.
        live = {o.track_id for o in objects}
        for key in [k for k in self._line_side if k[0] not in live]:
            if now - self._line_last_cross.get(key, 0) > 60:
                self._line_side.pop(key, None)
                self._line_last_cross.pop(key, None)
        return out
