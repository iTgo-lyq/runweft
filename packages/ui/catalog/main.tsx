// Component catalog: every Runweft UI component and its states in one page, in light and dark.
// It is also the fixture for the library's automated checks (packages/ui/verify.ts).
import { useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AccountChip, AppFrame, Avatar, Badge, Banner, Block, Button, Chain, Chips, ConfirmProvider, Crumbs, Dialog, Disclosure, EmptyState, Facts, Find,
  Form, Icon, IconSprite, InlineEdit, Loading, Menu, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, Mono, NavButton, NavItem, NavLabel,
  PageHead, Pager, PanelHead, PanelInner, PasswordField, Popover, Row, RowList, Section, Segmented, SelectField, Sidebar, SpaceSwitch, SplitView,
  SwitchRow, Tabs, Tag, TaskStatusBadge, TextAreaField, TextField, Toaster, Toolbar, Weft, taskStatus, toast, useConfirm, useFindShortcut, useSplit,
  type TaskStatus,
} from '../src';

type Theme = 'system' | 'light' | 'dark';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <Block title={title}><div className="catalog-row">{children}</div></Block>;
}

const rows = [
  { id: 'machine-mac', name: '林舟的 MacBook Pro', text: 'macOS · 在线', status: 'completed' as TaskStatus },
  { id: 'machine-bj', name: '构建服务器 bj-04', text: 'Linux · 在线', status: 'running' as TaskStatus },
  { id: 'machine-old', name: '旧工作站', text: '离线 3 天', status: 'unknown' as TaskStatus },
];

function Components() {
  const confirm = useConfirm();
  const split = useSplit<string>();
  const [segment, setSegment] = useState('all');
  const [chip, setChip] = useState('all');
  const [tab, setTab] = useState('overview');
  const [round, setRound] = useState('r2');
  const [space, setSpace] = useState('product');
  const [find, setFind] = useState('');
  const [shared, setShared] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [page, setPage] = useState(2);
  const [name, setName] = useState('林舟的 MacBook Pro');
  const [result, setResult] = useState('');
  useFindShortcut();
  const opened = rows.find(row => row.id === split.key);
  return (
    <div className="page-inner">
      <PageHead title="Runweft UI" description="组件目录：全部组件及其状态。视觉规范见 DESIGN.md。" actions={<Button variant="primary" icon="plus">主要操作</Button>} />

      <Group title="按钮">
        <Button variant="primary">主要</Button><Button>次要</Button><Button variant="ghost">幽灵</Button><Button variant="quiet">轻量</Button>
        <Button variant="link">链接</Button><Button variant="danger">危险</Button><Button disabled>不可用</Button>
        <Button size="sm" icon="refresh">小号</Button><Button size="lg" variant="primary">大号</Button><Button icon="more" iconOnly label="更多操作" variant="ghost" />
      </Group>

      <Group title="徽标与标签">
        {(Object.keys(taskStatus) as TaskStatus[]).map(status => <TaskStatusBadge key={status} status={status} />)}
        <Tag>默认</Tag><Tag tone="accent" icon="link">强调</Tag><Tag tone="warn">警示</Tag><Badge tone="lock" icon="lock">只读</Badge>
        <Avatar name="林舟" /><Avatar name="陈雨" hue={1} size="lg" /><Mono>machine-3f8a</Mono>
      </Group>

      <Block title="横幅与空态">
        <Banner tone="warn" title="执行未确认" actions={<Button size="sm" icon="refresh">刷新核对</Button>}>无法确认第 2 轮是否已经开始执行，不要重发。</Banner>
        <Banner tone="danger" title="请求未能完成">检查 Hub 连接后重试。</Banner>
        <Banner tone="offline" title="刷新失败：无法连接 Hub">下面是 10:00 读取的内容，可能已经变化。</Banner>
        <EmptyState icon="tasks" title="还没有任务" actions={<Button variant="primary">接入新环境</Button>}>通过 Agent 发起首次委派后，任务会出现在这里。</EmptyState>
        <Loading />
      </Block>

      <Block title="事实与关系">
        <Facts rows={[['状态', <TaskStatusBadge status="running" />], ['工作区', <Mono>/Users/lin/work/runweft-web</Mono>], ['最后观察', '2 分钟前'], false]} />
        <p><Chain parts={['林舟的 MacBook Pro', 'Claude Code', '第 2 轮']} /></p>
        <Weft currentId={round} onSelect={setRound} rounds={[
          { id: 'r1', ordinal: 1, tone: 'ok', phaseLabel: '已完成' }, { id: 'r2', ordinal: 2, tone: 'accent', phaseLabel: '进行中' }, { id: 'r3', ordinal: 3, phaseLabel: '排队' },
        ]} />
        <Disclosure summary="诊断数据" hint="原始结构"><Facts compact rows={[['会话', <Mono>session-91f0</Mono>], ['配置版本', 'v3']]} /></Disclosure>
      </Block>

      <Block title="表单">
        <Form onSubmit={() => toast('已保存')} actions={<><Button>取消</Button><Button type="submit" variant="primary">保存</Button></>}>
          <TextField label="机器名称" hint="最多 64 个字符。" required maxLength={64} defaultValue="构建服务器" />
          <PasswordField label="密码" autoComplete="current-password" />
          <SelectField label="原生工具" options={[{ value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude Code' }]} defaultValue="codex" />
          <TextAreaField label="业务指令" mono rows={3} defaultValue="审阅当前分支，列出需要修改的地方。" />
        </Form>
        <div className="switch-list">
          <SwitchRow label="共享到“产品协作”" description="成员可以在这台机器上执行任务。" checked={shared} onCheckedChange={setShared} />
          <SwitchRow label="不可用的开关" checked={false} onCheckedChange={() => {}} disabled />
        </div>
      </Block>

      <Group title="选择与筛选">
        <Segmented label="外观" value={segment} onValueChange={setSegment} options={[{ value: 'all', label: '跟随系统', icon: 'display' }, { value: 'light', label: '浅色', icon: 'sun' }, { value: 'dark', label: '深色', icon: 'moon' }]} />
        <Chips label="任务状态" value={chip} onValueChange={setChip} options={[{ value: 'all', label: '全部' }, { value: 'attention', label: '需要处理' }, { value: 'running', label: '进行中' }, { value: 'done', label: '已完成' }]} />
        <Find value={find} onChange={setFind} />
      </Group>

      <Block title="标签页">
        <Tabs label="任务详情" value={tab} onValueChange={setTab} items={[{ id: 'overview', label: '概览' }, { id: 'delivery', label: '交付' }, { id: 'more', label: '继续处理' }]}>
          <p>当前标签：{tab}</p>
        </Tabs>
      </Block>

      <Group title="浮层">
        <Menu label="切换空间" trigger={<SpaceSwitch name={space === 'product' ? '产品协作' : '个人实验'} detail="所有者 · 切换空间" style={{ width: 240 }} />}>
          <MenuLabel>我的空间</MenuLabel>
          <MenuRadioGroup value={space} onValueChange={setSpace}>
            <MenuRadioItem value="product" icon="space" description="所有者" checked={space === 'product'}>产品协作</MenuRadioItem>
            <MenuRadioItem value="lab" icon="space" description="所有者" checked={space === 'lab'}>个人实验</MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem icon="plus" onSelect={() => toast('创建空间', 'info')}>创建空间…</MenuItem>
          <MenuItem icon="logout" danger onSelect={() => toast('退出', 'warn')}>退出此浏览器</MenuItem>
        </Menu>
        <Menu label="更多操作" align="end" trigger={<Button icon="more" iconOnly label="更多操作" variant="ghost" />}>
          <MenuItem icon="key" description="凭据 cred-m-91a2">查看凭据</MenuItem>
          <MenuItem icon="minus-circle" danger>取消登记</MenuItem>
        </Menu>
        <Popover label="筛选" trigger={<Button icon="filter">筛选</Button>}>
          <Form onSubmit={() => toast('已应用筛选')} actions={<Button type="submit" variant="primary" size="sm">应用</Button>}>
            <TextField label="来源工作目录" placeholder="/Users/lin/work" />
          </Form>
        </Popover>
        <Button onClick={() => setDialog(true)}>打开对话框</Button>
        <Button onClick={async () => setResult(String(await confirm('确认保存这些设置？', { title: '保存设置？', confirmLabel: '保存' })))}>确认框</Button>
        <Button variant="danger" onClick={async () => setResult(String(await confirm('撤回后这个空间的成员不能再使用这台机器。', { title: '撤回共享？', confirmLabel: '撤回', danger: true })))}>危险确认</Button>
        <Button onClick={() => toast('设置已保存')}>轻提示</Button>
        <output id="confirm-result">{result}</output>
      </Group>
      <Dialog open={dialog} onOpenChange={setDialog} title="登记仓库" description="仓库属于当前空间，用来识别 Git 项目。"
        footer={<><Button onClick={() => setDialog(false)}>取消</Button><Button variant="primary" onClick={() => setDialog(false)}>登记仓库</Button></>}>
        <TextField label="仓库名称" placeholder="例如 runweft-web" />
      </Dialog>

      <Block title="列表与检查器">
        <SplitView split={split} label="机器详情" list={
          <RowList label="机器列表">
            {rows.map(row => (
              <Row key={row.id} rowKey={row.id} opened={split.key === row.id} onOpen={from => split.open(row.id, { from })}>
                <span className="row-icon" data-tone="accent"><Icon name="machine" /></span>
                <span className="row-main">
                  <span className="row-top"><strong className="row-title">{row.name}</strong><span className="row-time">刚刚</span></span>
                  <span className="row-text">{row.text}</span>
                  <span className="row-meta"><TaskStatusBadge status={row.status} /></span>
                </span>
              </Row>
            ))}
          </RowList>
        }>
          {opened && (
            <PanelInner>
              <PanelHead title={opened.name} badges={<TaskStatusBadge status={opened.status} />} sub={<Mono>{opened.id}</Mono>} onClose={() => split.close()} />
              <Section title="名称"><InlineEdit label="机器名称" value={name} onSave={async value => { setName(value); toast('机器名称已保存'); }} /></Section>
              <Section title="说明"><p className="section-lead">{opened.text}</p></Section>
            </PanelInner>
          )}
        </SplitView>
        <Pager page={page} pages={3} onPage={setPage} />
      </Block>
    </div>
  );
}

function ShellPreview({ onExit }: { onExit: () => void }) {
  const [nav, setNav] = useState(false);
  return (
    <AppFrame navOpen={nav} onNavOpenChange={setNav}
      sidebar={
        <Sidebar onClose={() => setNav(false)} top={<SpaceSwitch name="产品协作" detail="所有者 · 切换空间" />}
          foot={<><NavButton icon="link" onClick={() => toast('接入新环境', 'info')}>接入新环境</NavButton><AccountChip name="林舟" username="linzhou" /></>}>
          <NavLabel>工作</NavLabel>
          <NavItem icon="tasks" current onSelect={() => setNav(false)}>任务</NavItem>
          <NavLabel>执行资源</NavLabel>
          <NavItem icon="machine" onSelect={() => setNav(false)}>机器</NavItem>
          <NavItem icon="runtime" onSelect={() => setNav(false)}>Runtime</NavItem>
        </Sidebar>
      }
      toolbar={<Toolbar onOpenNav={() => setNav(true)} crumbs={<Crumbs space="产品协作" page="任务" />} actions={<Button icon="refresh" iconOnly label="刷新" variant="ghost" />} />}>
      <div className="page-inner">
        <PageHead title="任务" description="工作台壳预览：侧栏在窗口背景上，内容是一块表面，工具栏是玻璃。" actions={<Button onClick={onExit}>返回组件目录</Button>} />
        {Array.from({ length: 24 }, (_, index) => <p key={index}>内容第 {index + 1} 行，滚动时从玻璃工具栏下方经过。</p>)}
      </div>
    </AppFrame>
  );
}

function Catalog() {
  const [theme, setTheme] = useState<Theme>('system');
  const [view, setView] = useState(location.hash === '#shell' ? 'shell' : 'components');
  const applyTheme = (value: Theme) => { setTheme(value); document.documentElement.dataset.theme = value; };
  const go = (next: string) => { setView(next); history.replaceState(null, '', next === 'shell' ? '#shell' : '#'); };
  return (
    <ConfirmProvider>
      <IconSprite />
      {view === 'shell' ? <ShellPreview onExit={() => go('components')} /> : (
        <div className="catalog">
          <header className="catalog-bar">
            <Segmented label="外观" value={theme} onValueChange={applyTheme} options={[{ value: 'system', label: '跟随系统', icon: 'display' }, { value: 'light', label: '浅色', icon: 'sun' }, { value: 'dark', label: '深色', icon: 'moon' }]} />
            <Button onClick={() => go('shell')}>工作台壳</Button>
          </header>
          <main className="surface catalog-surface" id="page"><Components /></main>
        </div>
      )}
      <Toaster />
    </ConfirmProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Catalog />);
