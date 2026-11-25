"""Pose toolkit for authoring MARTIALDEX technique animations in Blender (Phase 1.3, no motion capture).

Works on the Mesh2Motion human rig (UE-mannequin bone names). Everything is expressed in the CHARACTER frame
measured from the rest skeleton: x = character's left, y = forward (towards the opponent), z = up, origin on the
floor under the rest pelvis. A pose is solved from rest every frame, in hierarchy order:
pelvis (position + rotation) -> spine -> clavicles -> arms (two-bone IK, palm orientation, fists) -> neck/head
(gaze held on the target) -> legs (two-bone IK to planted feet, foot pivot / heel lift, toes kept flat).
Only rotations are keyed, plus the pelvis location (Mesh2Motion convention: no root motion, rotation keys only).
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

FINGERS = ("index", "middle", "ring", "pinky")
MAX_BEND_TURN = 35.0  # Phase 7 continuity: degrees per key


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def ease_out(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_in_out(t):
    t = max(0.0, min(1.0, t))
    return 0.5 - 0.5 * math.cos(math.pi * t)


def lerp(a, b, t):
    return a + (b - a) * t


def vlerp(a, b, t):
    return Vector(a).lerp(Vector(b), t)


class Rig:
    def __init__(self, arm, placement=None):
        """placement (two-person clips, Phase 5): (dx, dy, yaw_deg) in the unplaced character frame — the whole
        skeleton is moved there through the `root` bone, and every frame below (O, L, F, rest) is measured on the
        placed skeleton, so a technique module still writes poses in "this character's own" frame."""
        self.arm = arm
        self.pb = arm.pose.bones
        # Phase 7 (opt-in, author_duo.py): keys are solved in order, and the solver remembers the previous key's elbow /
        # knee bend direction and forearm roll, so a pole that lines up with the limb or a palm roll crossing 180 deg
        # cannot flip the joint between two keys. `memo` is switched off for trial solves (blends solve twice).
        self.continuity = False
        self.memo = True
        self._bend = {}
        self._roll = {}
        self.MW = arm.matrix_world.copy()
        self.M3 = self.MW.to_3x3()
        self.M3i = self.M3.inverted()
        self.placement = None
        self.reset()
        self._measure_frame()
        if placement:
            dx, dy, yaw = placement
            T = Matrix.Translation(self.cp(dx, dy, 0)) @ self.yaw(yaw).to_4x4() @ Matrix.Translation(-self.O)
            self.placement = self.MW.inverted() @ T @ self.MW  # armature-space transform applied to the root bone
            self.reset()
            self._measure_frame()
        # rest measurements
        self.rest = {n: (self.head(n).copy(), self.tail(n).copy(), self.world_rot(n).copy()) for n in [b.name for b in arm.pose.bones]}
        self.palm_local = {s: self.world_rot(f"hand_{s}").transposed() @ (-self.U) for s in ("l", "r")}  # T-pose palms face down
        self.ball_to_ankle = {s: self.head(f"foot_{s}") - self.head(f"ball_{s}") for s in ("l", "r")}
        self.ball_height = self.head("ball_l").z
        # Phase 7 hinge (continuity mode): the elbow / knee bends about ONE axis fixed in the upper bone — elbows fold
        # towards the front of the rest pose (biceps side), knees fold the shin backwards
        self._hinge_local = {}
        for up, sign in (("upperarm_l", 1.0), ("upperarm_r", 1.0), ("thigh_l", -1.0), ("thigh_r", -1.0)):
            h, t, R = self.rest[up]
            u0 = (t - h).normalized()
            n0 = u0.cross(self.F * sign).normalized()
            self._hinge_local[up] = R.transposed() @ n0

    def _measure_frame(self):
        self.U = Vector((0, 0, 1))
        L = self.head("upperarm_l") - self.head("upperarm_r")
        self.L = (L - self.U * L.dot(self.U)).normalized()
        self.F = self.L.cross(self.U).normalized()
        if self.F.dot(self.head("ball_l") - self.head("foot_l")) < 0:
            self.L, self.F = -self.L, -self.F
        p = self.head("pelvis")
        self.O = Vector((p.x, p.y, 0.0))

    # ---- frame helpers
    def cv(self, x, y, z):
        return self.L * x + self.F * y + self.U * z

    def cp(self, x, y, z):
        return self.O + self.cv(x, y, z)

    def to_char(self, p):
        d = p - self.O
        return Vector((d.dot(self.L), d.dot(self.F), d.dot(self.U)))

    def yaw(self, deg):
        """Rotation about up; positive turns forward towards the character's left."""
        return Matrix.Rotation(math.radians(deg), 3, self.U) if self.L.cross(self.F).dot(self.U) < 0 else Matrix.Rotation(math.radians(-deg), 3, self.U)

    def about(self, axis, deg):
        return Matrix.Rotation(math.radians(deg), 3, axis)

    # ---- bone state (world)
    def head(self, n):
        return self.MW @ self.pb[n].head

    def tail(self, n):
        return self.MW @ self.pb[n].tail

    def axis(self, n):
        return (self.tail(n) - self.head(n)).normalized()

    def world_rot(self, n):
        return self.M3 @ self.pb[n].matrix.to_3x3()

    def update(self):
        bpy.context.view_layer.update()

    def reset(self):
        for b in self.arm.pose.bones:
            b.rotation_mode = "QUATERNION"
            b.matrix_basis = Matrix.Identity(4)
        self.update()
        if self.placement is not None:
            r = self.pb["root"]
            r.matrix = self.placement @ r.matrix
            self.update()

    def rotate(self, n, R):
        """Rotate bone n about its head by world rotation R; children follow."""
        b = self.pb[n]
        Ra = (self.M3i @ R @ self.M3).to_4x4()
        h = b.head.copy()
        b.matrix = Matrix.Translation(h) @ Ra @ Matrix.Translation(-h) @ b.matrix
        self.update()

    def aim(self, n, d):
        self.rotate(n, self.axis(n).rotation_difference(Vector(d).normalized()).to_matrix())

    def move(self, n, world_pos):
        b = self.pb[n]
        m = b.matrix.copy()
        m.translation = self.MW.inverted() @ world_pos
        b.matrix = m
        self.update()

    def set_world_rot(self, n, Rw):
        """Give bone n exactly the world orientation Rw (3x3), keeping its head where the parent puts it."""
        b = self.pb[n]
        h = b.head.copy()
        b.matrix = Matrix.Translation(h) @ (self.M3i @ Rw).to_4x4()
        self.update()

    def twist(self, n, deg):
        self.rotate(n, self.about(self.axis(n), deg))

    # ---- limbs
    def ik2(self, upper, lower, target, pole):
        """Two-bone IK: place the end of `lower` at target, bend plane towards `pole` (world direction)."""
        S = self.head(upper)
        L1 = (self.head(lower) - S).length
        L2 = (self.tail(lower) - self.head(lower)).length if not lower.startswith(("calf", "lowerarm")) else None
        end = {"lowerarm_l": "hand_l", "lowerarm_r": "hand_r", "calf_l": "foot_l", "calf_r": "foot_r"}[lower]
        L2 = (self.head(end) - self.head(lower)).length
        dv = target - S
        d = min(max(dv.length, abs(L1 - L2) + 1e-4), L1 + L2 - 1e-4)
        u = dv.normalized()
        pv = Vector(pole).normalized() if Vector(pole).length > 1e-9 else self.U
        p = pv - u * pv.dot(u)
        prev = self._bend.get(upper) if self.continuity else None
        if prev is not None:
            # near-singular pole (lined up with the limb): lean on the previous key's bend direction
            q = prev - u * prev.dot(u)
            if p.length < 0.5 and q.length > 1e-6:
                p = p + q.normalized() * (0.5 - p.length)
            p = p.normalized() if p.length > 1e-6 else self.U
            if q.length > 1e-6:
                # the bend plane turns at most MAX_BEND_TURN degrees between two keys (no elbow / knee flip)
                q = q.normalized()
                ang = math.degrees(q.angle(p)) if q.dot(p) < 0.999999 else 0.0
                if ang > MAX_BEND_TURN:
                    k = q.cross(p)
                    k = k.normalized() if k.length > 1e-6 else u
                    p = Matrix.Rotation(math.radians(MAX_BEND_TURN), 3, k) @ q
        p = p.normalized() if p.length > 1e-6 else self.U
        if self.continuity and self.memo:
            self._bend[upper] = p.copy()
        ca = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)
        E = S + L1 * (ca * u + math.sqrt(max(0.0, 1 - ca * ca)) * p)
        self.aim(upper, E - S)
        if self.continuity and upper in self._hinge_local:
            # hinge solve: roll the upper bone so its elbow / knee axis is the bend-plane normal, then swing the lower
            # bone about that axis only. Aiming the lower bone by the shortest rotation is ill-defined when the joint is
            # folded (the guard fist next to the chin): its roll could jump by up to 180 deg between two keys.
            ua = self.axis(upper)
            w = ((S + u * d) - self.head(lower)).normalized()
            nd = ua.cross(w)
            if nd.length < 1e-3:
                nd = ua.cross(-p)
            nd.normalize()
            ncur = self.world_rot(upper) @ self._hinge_local[upper]
            ncur = (ncur - ua * ncur.dot(ua)).normalized()
            self.rotate(upper, self.about(ua, math.degrees(math.atan2(ncur.cross(nd).dot(ua), ncur.dot(nd)))))
            c = self.axis(lower)
            self.rotate(lower, self.about(nd, math.degrees(math.atan2(c.cross(w).dot(nd), c.dot(w)))))
            self.aim(lower, w)  # removes the last fraction of a degree (rest pose not exactly straight)
        else:
            self.aim(lower, (S + u * d) - self.head(lower))
        return E

    def palm(self, s, normal, forearm_share=0.5):
        """Roll forearm + hand about the forearm axis so the palm faces `normal` (world)."""
        ax = self.axis(f"lowerarm_{s}")
        cur = self.world_rot(f"hand_{s}") @ self.palm_local[s]
        a = (cur - ax * cur.dot(ax)).normalized()
        b_raw = Vector(normal) - ax * Vector(normal).dot(ax)
        b = b_raw.normalized()
        ang = math.degrees(math.atan2(a.cross(b).dot(ax), a.dot(b)))
        # a palm direction (almost) along the forearm leaves the roll undefined: fade towards the previous key's roll
        weight = min(1.0, b_raw.length / 0.4)
        if self.continuity and weight < 1.0 and s in self._roll:
            prev = self._roll[s]
            while ang - prev > 180.0:
                ang -= 360.0
            while ang - prev < -180.0:
                ang += 360.0
            ang = prev + (ang - prev) * weight
        if self.continuity:
            # unwrap against the previous key's roll: a target palm crossing +-180 deg keeps turning the same way
            prev = self._roll.get(s)
            if prev is not None:
                while ang - prev > 180.0:
                    ang -= 360.0
                while ang - prev < -180.0:
                    ang += 360.0
            if self.memo:
                self._roll[s] = ang
        self.twist(f"lowerarm_{s}", ang * forearm_share)
        self.rotate(f"hand_{s}", self.about(ax, ang * (1 - forearm_share)))

    def hand_follow(self, s, flex_deg=0.0):
        """Hand in line with the forearm (fist straight), optional flex about the palm's side axis."""
        self.aim(f"hand_{s}", self.axis(f"lowerarm_{s}"))
        if flex_deg:
            n = self.world_rot(f"hand_{s}") @ self.palm_local[s]
            self.rotate(f"hand_{s}", self.about(self.axis(f"hand_{s}").cross(n).normalized(), flex_deg))

    def fist(self, s, curl=(88, 100, 75)):
        n = self.world_rot(f"hand_{s}") @ self.palm_local[s]
        for f in FINGERS:
            for j, deg in zip((1, 2, 3), curl):
                b = f"{f}_0{j}_{s}"
                k = self.axis(b).cross(n)
                if k.length > 1e-6:
                    self.rotate(b, self.about(k.normalized(), deg))
        # thumb wraps over the middle phalanges of the index and middle fingers (a closed fist, thumb outside)
        over = (self.head(f"index_02_{s}") + self.head(f"middle_02_{s}")) / 2 + n * 0.012
        self.aim(f"thumb_01_{s}", (self.head(f"index_01_{s}") + n * 0.02) - self.head(f"thumb_01_{s}"))
        self.aim(f"thumb_02_{s}", over - self.head(f"thumb_02_{s}"))
        self.aim(f"thumb_03_{s}", (self.head(f"middle_02_{s}") + n * 0.01) - self.head(f"thumb_03_{s}"))

    def plant_foot(self, s, ball_xy, yaw_deg, heel_lift_deg, knee_pole):
        """Leg IK to a planted foot: the ball of the foot stays on the floor at ball_xy (character frame), the foot
        points yaw_deg from forward, the heel is raised by heel_lift_deg about the ball."""
        R = self.yaw(yaw_deg)
        side = R @ self.L
        lift = self.about(side, heel_lift_deg)  # rotates the ball->ankle vector so the heel rises about the ball
        ball = self.cp(ball_xy[0], ball_xy[1], 0) + self.U * self.ball_height
        ankle = ball + lift @ R @ self.ball_to_ankle[s]
        self.ik2(f"thigh_{s}", f"calf_{s}", ankle, knee_pole)
        # the foot gets its FULL orientation (no inherited roll): rest orientation turned by yaw, pitched by the
        # heel lift — so the sole stays level side to side
        self.set_world_rot(f"foot_{s}", lift @ R @ self.rest[f"foot_{s}"][2])
        # toes stay on the floor; the toe skin also carries part of the (pitched) foot's weight, so the toe joint
        # extends a little further than flat to keep the toe tips from sinking below the floor
        self.set_world_rot(f"ball_{s}", self.about(side, -0.45 * heel_lift_deg) @ R @ self.rest[f"ball_{s}"][2])

    # ---- keying
    def key_all(self, frame, prev):
        for b in self.arm.pose.bones:
            q = b.rotation_quaternion.copy()
            if b.name in prev and prev[b.name].dot(q) < 0:
                q.negate()
                b.rotation_quaternion = q
            prev[b.name] = q.copy()
            b.keyframe_insert("rotation_quaternion", frame=frame)
        self.pb["pelvis"].keyframe_insert("location", frame=frame)
