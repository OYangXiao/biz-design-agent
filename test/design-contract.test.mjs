// Executable design examples, not a production importer or scenario runner.
import test from 'node:test';
import assert from 'node:assert/strict';

const profiles = [
  {team:'ops', product:'returns', surface:'desktop', revision:1, approvedBy:'Lin',
    rules:{workspace:'edit-in-place', component:'returns/ApprovalRow', feedback:'ticket'}},
  {team:'events', product:'signup', surface:'mobile', revision:1, approvedBy:'Wu',
    rules:{workspace:'review-copy', component:'events/BottomBar', feedback:'canvas'}},
];
const cases = {
  prototype: ['journey', 'target'],
  design: ['states', 'target', 'assets'],
  demo: ['journey', 'audience', 'sourceVersion'],
  functional: ['journey', 'url', 'build', 'fixture'],
  visual: ['url', 'build', 'approvedFrame', 'viewport', 'state'],
};
function plan(request, catalog = profiles) {
  const profile = catalog.find(p => ['team','product','surface','revision'].every(k => p[k] === request[k]));
  if (!profile?.approvedBy) throw Error('no approved profile');
  return request.outputs.map(output => {
    const missing = cases[output].filter(k => !request.inputs[k]);
    return {output, missing, rules:structuredClone(profile.rules), revision:profile.revision};
  });
}
const request = (p, outputs, inputs) => ({...p, outputs, inputs});
const journey = [{id:'approve', expected:'已处理'}];
const web = {journey, url:'https://example.invalid/test', build:'r7', fixture:'R-17'};

test('同一协调器接受相反的团队资产、工作区及评审策略', () => {
  const run = p => plan(request(p, ['prototype'], {journey, target:'workspace'}))[0];
  assert.deepEqual(run(profiles[0]).rules, {workspace:'edit-in-place', component:'returns/ApprovalRow', feedback:'ticket'});
  assert.deepEqual(run(profiles[1]).rules, {workspace:'review-copy', component:'events/BottomBar', feedback:'canvas'});
});
test('同名产品不同团队、未确认的版本不能借用现有规范', () => {
  const r = request(profiles[0], ['prototype'], {});
  assert.throws(() => plan({...r, team:'unregistered'}), /no approved/);
  assert.throws(() => plan(r, [{...profiles[0], approvedBy:null}]), /no approved/);
});
test('增加团队版本不改变在审任务，显式切换才用新版', () => {
  const v2 = {...profiles[0], revision:2, rules:{...profiles[0].rules, component:'returns/NewApprovalRow'}};
  const r = request(profiles[0], ['design'], {states:['pending'], target:'workspace', assets:['library']});
  const catalog = [v2, ...profiles];
  assert.deepEqual(plan(r, catalog), plan(r));
  assert.equal(plan({...r, revision:2}, catalog)[0].rules.component, 'returns/NewApprovalRow');
});
test('只选功能报告：不要求 Figma 设计源、批准屏或演示材料', () => {
  const steps = plan(request(profiles[0], ['functional'], web));
  assert.deepEqual(steps.map(s => [s.output, s.missing]), [['functional', []]]);
});
test('演示引用同一流程；单屏视觉对图不强制提供业务流程', () => {
  const inputs = {...web, audience:'业务评审', sourceVersion:'figma@2', target:'workspace',
    states:['pending'], assets:['library'], viewport:'1280x800@1', state:'pending', approvedFrame:'frame@2'};
  const steps = plan(request(profiles[0], Object.keys(cases), inputs));
  assert.equal(steps.length, 5);
  assert.ok(steps.every(s => !s.missing.length));
  assert.deepEqual(plan(request(profiles[0], ['visual'], {...inputs, journey:null}))[0].missing, []);
});
test('两项一起申请：缺设计基准仅阻塞对图，不阻塞功能验收', () => {
  const [func, visual] = plan(request(profiles[0], ['functional','visual'], {...web, viewport:'1280x800@1', state:'pending'}));
  assert.deepEqual(func.missing, []);
  assert.deepEqual(visual.missing, ['approvedFrame']);
});

function functionalResult(step, observation, expectedBuild) {
  if (!observation?.evidence || observation.step !== step.id ||
      observation.build !== expectedBuild || observation.actual == null) return '未测';
  return observation.actual === step.expected ? '通过' : '失败';
}
test('证据绑定步骤和构建；错文案是失败，不可观测或旧版是未测', () => {
  const observed = {step:'approve', actual:'已处理', build:'r7', evidence:'fixture:snapshot'};
  const check = o => functionalResult(journey[0], o, 'r7');
  assert.deepEqual([observed, {...observed, actual:'待审'}, {...observed, build:'r6'},
    {...observed, step:'cancel'}, {...observed, evidence:null}, null].map(check),
    ['通过','失败','未测','未测','未测','未测']);
});
