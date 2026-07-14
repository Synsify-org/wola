import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePipeline, effectiveStages, route, canAct,
  stageCanGenerateSchedule, validateDecision,
} from "../dist/approval.js";

const stage = (id, position, approverRole) => ({
  id, position, approverRole, slaHours: null, allowDelegation: true,
});

// MUA's default chain: dept_head -> hr -> cfo -> ceo
const defaultPipeline = {
  id: "p-default", appliesTo: "default",
  stages: [stage("s1", 1, "dept_head"), stage("s2", 2, "hr"), stage("s3", 3, "cfo"), stage("s4", 4, "ceo")],
};
// MUA's CEO chain for dev/car: hr -> cfo -> coo -> group_ceo
const ceoPipeline = {
  id: "p-ceo", appliesTo: "ceo",
  stages: [stage("c1", 1, "hr"), stage("c2", 2, "cfo"), stage("c3", 3, "coo"), stage("c4", 4, "group_ceo")],
};
const pipelines = [defaultPipeline, ceoPipeline];

test("pipeline selection: employee gets the default chain", () => {
  const p = resolvePipeline(pipelines, "employee");
  assert.equal(p.id, "p-default");
});

test("pipeline selection: CEO gets their special chain", () => {
  const p = resolvePipeline(pipelines, "ceo");
  assert.equal(p.id, "p-ceo");
});

test("NO SELF-APPROVAL: the CFO's own application skips the CFO stage", () => {
  const stages = effectiveStages(defaultPipeline, "cfo");
  assert.deepEqual(stages.map((s) => s.approverRole), ["dept_head", "hr", "ceo"]);
});

test("NO SELF-APPROVAL: HR's own application skips the HR stage", () => {
  const stages = effectiveStages(defaultPipeline, "hr");
  assert.deepEqual(stages.map((s) => s.approverRole), ["dept_head", "cfo", "ceo"]);
});

test("routing: a fresh application sits at the first stage", () => {
  const r = route(defaultPipeline, "employee", []);
  assert.equal(r.state, "pending");
  assert.equal(r.currentStage.approverRole, "dept_head");
});

test("routing: approvals advance the application one stage at a time", () => {
  const r = route(defaultPipeline, "employee", [
    { stageId: "s1", decision: "approved" },
    { stageId: "s2", decision: "approved" },
  ]);
  assert.equal(r.state, "pending");
  assert.equal(r.currentStage.approverRole, "cfo");
  assert.equal(r.completed.length, 2);
});

test("routing: all stages approved => application approved", () => {
  const r = route(defaultPipeline, "employee", [
    { stageId: "s1", decision: "approved" },
    { stageId: "s2", decision: "approved" },
    { stageId: "s3", decision: "approved" },
    { stageId: "s4", decision: "approved" },
  ]);
  assert.equal(r.state, "approved");
  assert.equal(r.currentStage, null);
});

test("routing: a rejection terminates the application", () => {
  const r = route(defaultPipeline, "employee", [
    { stageId: "s1", decision: "approved" },
    { stageId: "s2", decision: "rejected", comment: "Existing exposure too high." },
  ]);
  assert.equal(r.state, "rejected");
  assert.equal(r.rejectedAt.approverRole, "hr");
  assert.equal(r.currentStage, null);
});

test("dept_head stage: only the applicant's OWN dept head may act", () => {
  const applicant = { employeeId: "e1", role: "employee", departmentHeadId: "e9" };
  const theirHead = { userId: "u9", employeeId: "e9", role: "employee" };
  const otherHead = { userId: "u8", employeeId: "e8", role: "dept_head" };
  const s = stage("s1", 1, "dept_head");
  assert.equal(canAct(s, theirHead, applicant), true);
  assert.equal(canAct(s, otherHead, applicant), false); // right role, wrong person
});

test("role stages match on membership role", () => {
  const applicant = { employeeId: "e1", role: "employee", departmentHeadId: "e9" };
  const cfo = { userId: "u3", employeeId: "e3", role: "cfo" };
  const hr = { userId: "u2", employeeId: "e2", role: "hr" };
  assert.equal(canAct(stage("s3", 3, "cfo"), cfo, applicant), true);
  assert.equal(canAct(stage("s3", 3, "cfo"), hr, applicant), false);
});

test("an applicant can never act on their own application", () => {
  const applicant = { employeeId: "e3", role: "cfo", departmentHeadId: "e9" };
  const self = { userId: "u3", employeeId: "e3", role: "cfo" };
  assert.equal(canAct(stage("s3", 3, "cfo"), self, applicant), false);
});

test("the CFO stage is where the schedule is generated", () => {
  assert.equal(stageCanGenerateSchedule(stage("s3", 3, "cfo")), true);
  assert.equal(stageCanGenerateSchedule(stage("s2", 2, "hr")), false);
});

test("a rejection without a reason is invalid", () => {
  assert.equal(validateDecision("rejected", "").ok, false);
  assert.equal(validateDecision("rejected", "   ").ok, false);
  assert.equal(validateDecision("rejected", "Too much exposure").ok, true);
  assert.equal(validateDecision("approved", null).ok, true);
});