/* ============================================================
   HackerSim — Elite Hacking Terminal
   script.js
   ============================================================ */

'use strict';

/* ── Code sources ─────────────────────────────────────────── */
const CODE_SOURCES = {
  linux: `/*
 * linux/kernel/sched/core.c
 *
 * Kernel scheduler and related syscalls
 *
 * Copyright (C) 1991-2002  Linus Torvalds
 */
#include <linux/highmem.h>
#include <linux/hrtimer_api.h>
#include <linux/ktime_api.h>
#include <linux/sched/signal.h>
#include <linux/syscalls_api.h>
#include <linux/debug_locks.h>
#include <linux/prefetch.h>
#include <linux/capability.h>
#include <linux/pgtable_api.h>
#include <linux/wait_bit.h>
#include <linux/jiffies.h>
#include <linux/spinlock_api_smp.h>
#include <linux/cpumask_api.h>
#include <linux/lockdep_api.h>
#include <linux/hardirq.h>
#include <linux/softirq.h>
#include <linux/refcount_api.h>
#include <linux/topology.h>
#include <linux/sched/clock.h>
#include <linux/sched/cond_resched.h>
#include <linux/sched/cputime.h>
#include <linux/sched/debug.h>
#include <linux/sched/hotplug.h>
#include <linux/sched/init.h>
#include <linux/sched/isolation.h>
#include <linux/sched/loadavg.h>
#include <linux/sched/mm.h>
#include <linux/sched/nohz.h>
#include <linux/sched/rseq_api.h>
#include <linux/sched/rt.h>

#include <linux/blkdev.h>
#include <linux/context_tracking.h>
#include <linux/cpuset.h>
#include <linux/delayacct.h>
#include <linux/init_task.h>
#include <linux/interrupt.h>
#include <linux/ioprio.h>
#include <linux/kallsyms.h>
#include <linux/kcov.h>
#include <linux/kprobes.h>
#include <linux/llist_api.h>
#include <linux/mmu_context.h>
#include <linux/mmzone.h>
#include <linux/mutex_api.h>
#include <linux/nmi.h>
#include <linux/nospec.h>
#include <linux/perf_event_api.h>
#include <linux/profile.h>
#include <linux/psi.h>
#include <linux/rcuwait_api.h>
#include <linux/sched/wake_q.h>
#include <linux/seccomp.h>
#include <linux/stackprotector.h>
#include <linux/syscalls.h>
#include <linux/threadgroup_api.h>
#include <linux/times.h>
#include <linux/tsacct_kern.h>
#include <linux/kthread.h>
#include <linux/livepatch.h>
#include <linux/stacktrace.h>
#include <linux/locallock_api.h>

#include <asm/switch_to.h>
#include <asm/tlb.h>

#include "../workqueue_internal.h"
#include "../../io_uring/io-wq.h"
#include "../smpboot.h"
#include "pelt.h"
#include "smp.h"
#include "stats.h"

DEFINE_PER_CPU_SHARED_ALIGNED(struct rq, runqueues);

#ifdef CONFIG_SCHED_DEBUG
/*
 * Debugging: various feature bits
 */
#define SCHED_FEAT(name, enabled)	\
	(1UL << __SCHED_FEAT_##name) * enabled |
const_debug unsigned int sysctl_sched_features =
#include "features.h"
	0;
#undef SCHED_FEAT

static const char * const sched_feat_names[] = {
#define SCHED_FEAT(name, enabled)	#name,
#include "features.h"
	NULL,
};
#undef SCHED_FEAT
#endif /* CONFIG_SCHED_DEBUG */

static int
sched_feat_show(struct seq_file *m, void *v)
{
	unsigned int i;

	for (i = 0; i < __SCHED_FEAT_NR; i++) {
		if (!(sysctl_sched_features & (1UL << i)))
			seq_puts(m, "NO_");
		seq_printf(m, "%s ", sched_feat_names[i]);
	}
	seq_puts(m, "\\n");

	return 0;
}

#ifdef HAVE_JUMP_LABEL
static void sched_feat_disable(int i)
{
	static_key_disable_cpuslocked(&sched_feat_keys[i]);
}

static void sched_feat_enable(int i)
{
	static_key_enable_cpuslocked(&sched_feat_keys[i]);
}
#else
static void sched_feat_disable(int i) { };
static void sched_feat_enable(int i) { };
#endif /* HAVE_JUMP_LABEL */

static int
sched_feat_set(char *cmp)
{
	unsigned int i;
	int neg = 0;

	if (strncmp(cmp, "NO_", 3) == 0) {
		neg = 1;
		cmp += 3;
	}

	i = match_string(sched_feat_names, __SCHED_FEAT_NR, cmp);
	if (i < 0)
		return i;

	if (neg) {
		sched_feat_disable(i);
	} else {
		sched_feat_enable(i);
	}

	return 0;
}

static ssize_t
sched_feat_write(struct file *filp, const char __user *ubuf,
		size_t cnt, loff_t *ppos)
{
	char buf[64];
	char *cmp;
	int ret;
	struct inode *inode;

	if (cnt > 63)
		cnt = 63;

	if (copy_from_user(&buf, ubuf, cnt))
		return -EFAULT;

	buf[cnt] = 0;

	/* Ensure the static_key remains in a consistent state */
	inode = file_inode(filp);
	cpus_read_lock();
	inode_lock(inode);
	cmp = strstrip(buf);
	ret = sched_feat_set(cmp);
	inode_unlock(inode);
	cpus_read_unlock();
	if (ret < 0)
		return ret;

	*ppos += cnt;

	return cnt;
}

static int sched_feat_open(struct inode *inode, struct file *filp)
{
	return single_open(filp, sched_feat_show, NULL);
}

static const struct file_operations sched_feat_fops = {
	.open		= sched_feat_open,
	.write		= sched_feat_write,
	.read		= seq_read,
	.llseek		= seq_lseek,
	.release	= single_release,
};

static __init int sched_init_debug(void)
{
	struct dentry *d;

	d = debugfs_create_dir("sched", NULL);
	debugfs_create_u32("latency_ns",  0644, d, &sysctl_sched_latency);
	debugfs_create_u32("min_gran_ns", 0644, d, &sysctl_sched_min_granularity);
	debugfs_create_u32("wakeup_gran_ns", 0644, d, &sysctl_sched_wakeup_granularity);
	debugfs_create_u32("child_runs_first", 0644, d, &sysctl_sched_child_runs_first);
	debugfs_create_u32("migration_cost_ns", 0644, d, &sysctl_sched_migration_cost);
	debugfs_create_u32("nr_migrate", 0644, d, &sysctl_sched_nr_migrate);
	debugfs_create_file("features", 0644, d, NULL, &sched_feat_fops);
	debugfs_create_u64("switch_count", 0444, d, &sched_switch_count);
	debugfs_create_u32("preempt_model", 0444, d, &sysctl_sched_preempt_model);

	return 0;
}
late_initcall(sched_init_debug);
#endif /* CONFIG_SCHED_DEBUG */

void update_rq_clock(struct rq *rq)
{
	s64 delta;

	lockdep_assert_rq_held(rq);

	if (rq->clock_update_flags & RQCF_ACT_SKIP)
		return;

	delta = sched_clock_cpu(cpu_of(rq)) - rq->clock;
	if (delta < 0)
		return;
	rq->clock += delta;
	update_rq_clock_task(rq, delta);
}

static void __init init_uclamp(void)
{
	struct uclamp_se uc_max = {};
	enum uclamp_id clamp_id;
	int cpu;

	mutex_lock(&uclamp_mutex);

	for_each_possible_cpu(cpu) {
		memset(&cpu_rq(cpu)->uclamp, 0, sizeof(struct uclamp_rq)*UCLAMP_CNT);
		cpu_rq(cpu)->uclamp_flags = UCLAMP_FLAG_IDLE;
	}

	for (clamp_id = 0; clamp_id < UCLAMP_CNT; clamp_id++) {
		uclamp_se_set(&init_task.uclamp_req[clamp_id],
			      uclamp_none(clamp_id), false);
	}

	/* System defaults allow max clamp values for both indexes */
	uclamp_se_set(&uc_max, uclamp_none(UCLAMP_MAX), false);
	for (clamp_id = 0; clamp_id < UCLAMP_CNT; clamp_id++) {
		uclamp_default[clamp_id] = uc_max;
#ifdef CONFIG_UCLAMP_TASK_GROUP
		root_task_group.uclamp_req[clamp_id] = uc_max;
		root_task_group.uclamp[clamp_id] = uc_max;
#endif
	}

	mutex_unlock(&uclamp_mutex);
}

void __init sched_init(void)
{
	unsigned long ptr = 0;
	int i;

	/* Make sure the linker didn't screw up */
	BUG_ON(MAX_PRIO > 140);
	BUG_ON(USER_PRIO_MAX != MAX_PRIO);

	wait_bit_init();

#ifdef CONFIG_FAIR_GROUP_SCHED
	ptr += 2 * nr_cpu_ids * sizeof(void **);
#endif
#ifdef CONFIG_RT_GROUP_SCHED
	ptr += 2 * nr_cpu_ids * sizeof(void **);
#endif
	if (ptr) {
		ptr = (unsigned long)kzalloc(ptr, GFP_NOWAIT);

		root_task_group.se = (struct sched_entity **)ptr;
		ptr += nr_cpu_ids * sizeof(void **);

		root_task_group.cfs_rq = (struct cfs_rq **)ptr;
		ptr += nr_cpu_ids * sizeof(void **);
		root_task_group.shares = ROOT_TASK_GROUP_LOAD;
		init_cfs_bandwidth(&root_task_group.cfs_bandwidth, NULL);
	}

	init_rt_bandwidth(&def_rt_bandwidth, global_rt_period(), global_rt_runtime());
	init_dl_bandwidth(&def_dl_bandwidth, global_rt_period(), 0);

	init_uclamp();

	for_each_possible_cpu(i) {
		struct rq *rq;

		rq = cpu_rq(i);
		raw_spin_lock_init(&rq->__lock);
		rq->nr_running = 0;
		rq->calc_load_active = 0;
		rq->calc_load_update = jiffies + LOAD_FREQ;
		init_cfs_rq(&rq->cfs);
		init_rt_rq(&rq->rt);
		init_dl_rq(&rq->dl);
#ifdef CONFIG_FAIR_GROUP_SCHED
		root_task_group.shares = ROOT_TASK_GROUP_LOAD;
		INIT_LIST_HEAD(&rq->leaf_cfs_rq_list);
		rq->tmp_alone_branch = &rq->leaf_cfs_rq_list;
		init_cfs_bandwidth(&root_task_group.cfs_bandwidth, NULL);
		init_tg_cfs_entry(&root_task_group, &rq->cfs, NULL, i, NULL);
#endif
		rq->rt.rt_runtime = def_rt_bandwidth.rt_runtime;
#ifdef CONFIG_RT_GROUP_SCHED
		init_tg_rt_entry(&root_task_group, &rq->rt, NULL, i, NULL);
#endif
#ifdef CONFIG_SMP
		rq->sd = NULL;
		rq->rd = NULL;
		rq->cpu_capacity = SCHED_CAPACITY_SCALE;
		rq->balance_callback = &balance_push_callback;
		rq->active_balance = 0;
		rq->next_balance = jiffies;
		rq->push_cpu = 0;
		rq->cpu = i;
		rq->online = 0;
		rq->idle_stamp = 0;
		rq->avg_idle = 2*sysctl_sched_migration_cost;
		rq->wake_stamp = jiffies;
		rq->wake_avg_idle = rq->avg_idle;
		rq->max_idle_balance_cost = sysctl_sched_migration_cost;
		INIT_LIST_HEAD(&rq->cfs_tasks);
		rq_attach_root(rq, &def_root_domain);
#ifdef CONFIG_NO_HZ_COMMON
		rq->last_blocked_load_update_tick = jiffies;
		atomic_set(&rq->nohz_flags, 0);
		INIT_CSD(&rq->nohz_csd, nohz_csd_func, rq);
#endif
#ifdef CONFIG_HOTPLUG_CPU
		rculist_init(&rq->dcbl);
#endif
#endif
		hrtick_rq_init(rq);
		atomic_set(&rq->nr_iowait, 0);
		fair_server_init(rq);

#ifdef CONFIG_SMP
		zalloc_cpumask_var_node(&rq->scratch_mask, GFP_KERNEL, cpu_to_node(i));
#endif
	}

	set_load_weight(&init_task, false);

	plist_head_init(&init_task.pi_waiters);

	/*
	 * The boot idle thread does lazy MMU switching as well:
	 */
	mmgrab_lazy_tlb(&init_mm);
	enter_lazy_tlb(&init_mm, current);

	init_idle(current, smp_processor_id());
	calc_load_update = jiffies + LOAD_FREQ;

#ifdef CONFIG_SMP
	idle_thread_set_boot_cpu();
	balance_push_set(smp_processor_id(), false);
#endif
	init_sched_fair_class();
	init_sched_rt_class();
	init_sched_dl_class();
	init_sched_ext_class();

	sched_init_granularity();
	psi_init();
	init_uclamp();

	preempt_dynamic_init();

	scheduler_running = 1;
}
`,

  python: `#!/usr/bin/env python3
"""
neural_network.py - Deep Learning Framework
A minimal but complete neural network implementation.
"""

import numpy as np
from typing import List, Tuple, Optional, Callable
from dataclasses import dataclass, field
import logging
import time
import json
import os

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)


# ── Activation functions ─────────────────────────────────────

def relu(x: np.ndarray) -> np.ndarray:
    return np.maximum(0, x)

def relu_derivative(x: np.ndarray) -> np.ndarray:
    return (x > 0).astype(float)

def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -500, 500)))

def sigmoid_derivative(x: np.ndarray) -> np.ndarray:
    s = sigmoid(x)
    return s * (1 - s)

def tanh_act(x: np.ndarray) -> np.ndarray:
    return np.tanh(x)

def tanh_derivative(x: np.ndarray) -> np.ndarray:
    return 1.0 - np.tanh(x) ** 2

def softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return e / np.sum(e, axis=-1, keepdims=True)

ACTIVATIONS: dict = {
    'relu':    (relu,     relu_derivative),
    'sigmoid': (sigmoid,  sigmoid_derivative),
    'tanh':    (tanh_act, tanh_derivative),
}


# ── Loss functions ───────────────────────────────────────────

def mse_loss(y_pred: np.ndarray, y_true: np.ndarray) -> float:
    return float(np.mean((y_pred - y_true) ** 2))

def mse_derivative(y_pred: np.ndarray, y_true: np.ndarray) -> np.ndarray:
    return 2 * (y_pred - y_true) / y_true.size

def cross_entropy_loss(y_pred: np.ndarray, y_true: np.ndarray) -> float:
    eps = 1e-12
    return float(-np.mean(np.sum(y_true * np.log(y_pred + eps), axis=-1)))

def cross_entropy_derivative(y_pred: np.ndarray, y_true: np.ndarray) -> np.ndarray:
    return y_pred - y_true


# ── Layer ────────────────────────────────────────────────────

@dataclass
class Layer:
    in_dim:   int
    out_dim:  int
    activation: str = 'relu'
    dropout:  float = 0.0
    weights:  np.ndarray = field(init=False)
    biases:   np.ndarray = field(init=False)
    vW:       np.ndarray = field(init=False)  # Adam moment 1
    vB:       np.ndarray = field(init=False)
    sW:       np.ndarray = field(init=False)  # Adam moment 2
    sB:       np.ndarray = field(init=False)
    cache:    dict       = field(default_factory=dict)

    def __post_init__(self) -> None:
        # He initialisation for ReLU, Xavier for others
        if self.activation == 'relu':
            std = np.sqrt(2.0 / self.in_dim)
        else:
            std = np.sqrt(1.0 / self.in_dim)
        self.weights = np.random.randn(self.in_dim, self.out_dim) * std
        self.biases  = np.zeros((1, self.out_dim))
        self.vW = np.zeros_like(self.weights)
        self.vB = np.zeros_like(self.biases)
        self.sW = np.zeros_like(self.weights)
        self.sB = np.zeros_like(self.biases)

    def forward(self, x: np.ndarray, training: bool = True) -> np.ndarray:
        z = x @ self.weights + self.biases
        act_fn, _ = ACTIVATIONS[self.activation]
        a = act_fn(z)
        # Dropout
        mask = np.ones_like(a)
        if training and self.dropout > 0:
            mask = (np.random.rand(*a.shape) > self.dropout) / (1 - self.dropout)
            a *= mask
        self.cache = {'x': x, 'z': z, 'a': a, 'mask': mask}
        return a

    def backward(self, grad_out: np.ndarray) -> np.ndarray:
        x   = self.cache['x']
        z   = self.cache['z']
        mask = self.cache['mask']
        _, act_d = ACTIVATIONS[self.activation]
        delta = grad_out * mask * act_d(z)
        self.cache['dW'] = x.T @ delta / x.shape[0]
        self.cache['dB'] = np.mean(delta, axis=0, keepdims=True)
        return delta @ self.weights.T


# ── Network ──────────────────────────────────────────────────

class NeuralNetwork:
    def __init__(
        self,
        layer_dims:  List[Tuple[int, int, str, float]],
        loss:        str   = 'mse',
        lr:          float = 1e-3,
        beta1:       float = 0.9,
        beta2:       float = 0.999,
        epsilon:     float = 1e-8,
        l2_lambda:   float = 0.0,
    ) -> None:
        self.layers: List[Layer] = []
        for (in_d, out_d, act, drop) in layer_dims:
            self.layers.append(Layer(in_d, out_d, act, drop))
        self.loss_fn   = mse_loss        if loss == 'mse' else cross_entropy_loss
        self.loss_d    = mse_derivative  if loss == 'mse' else cross_entropy_derivative
        self.lr        = lr
        self.beta1     = beta1
        self.beta2     = beta2
        self.eps       = epsilon
        self.l2        = l2_lambda
        self.t         = 0          # Adam time-step
        self.history: List[float] = []

    def predict(self, x: np.ndarray, training: bool = False) -> np.ndarray:
        out = x
        for layer in self.layers:
            out = layer.forward(out, training=training)
        return out

    def _backward(self, y_pred: np.ndarray, y_true: np.ndarray) -> None:
        grad = self.loss_d(y_pred, y_true)
        for layer in reversed(self.layers):
            grad = layer.backward(grad)

    def _adam_update(self, layer: Layer) -> None:
        self.t += 1
        for param, grad, v, s in [
            ('weights', 'dW', 'vW', 'sW'),
            ('biases',  'dB', 'vB', 'sB'),
        ]:
            g = layer.cache[grad]
            if param == 'weights':
                g += self.l2 * getattr(layer, param)
            v_new = self.beta1 * getattr(layer, v) + (1 - self.beta1) * g
            s_new = self.beta2 * getattr(layer, s) + (1 - self.beta2) * g ** 2
            setattr(layer, v, v_new)
            setattr(layer, s, s_new)
            v_hat = v_new / (1 - self.beta1 ** self.t)
            s_hat = s_new / (1 - self.beta2 ** self.t)
            update = self.lr * v_hat / (np.sqrt(s_hat) + self.eps)
            setattr(layer, param, getattr(layer, param) - update)

    def train_step(self, x: np.ndarray, y: np.ndarray) -> float:
        y_pred = self.predict(x, training=True)
        loss   = self.loss_fn(y_pred, y)
        self._backward(y_pred, y)
        for layer in self.layers:
            self._adam_update(layer)
        return loss

    def fit(
        self,
        x_train:  np.ndarray,
        y_train:  np.ndarray,
        epochs:   int   = 100,
        batch:    int   = 32,
        verbose:  bool  = True,
        val_data: Optional[Tuple[np.ndarray, np.ndarray]] = None,
    ) -> List[float]:
        n = x_train.shape[0]
        for epoch in range(1, epochs + 1):
            idx = np.random.permutation(n)
            x_s, y_s = x_train[idx], y_train[idx]
            epoch_loss = 0.0
            steps = 0
            for i in range(0, n, batch):
                xb = x_s[i:i + batch]
                yb = y_s[i:i + batch]
                epoch_loss += self.train_step(xb, yb)
                steps += 1
            epoch_loss /= max(steps, 1)
            self.history.append(epoch_loss)
            if verbose and (epoch % 10 == 0 or epoch == 1):
                val_str = ''
                if val_data is not None:
                    vp = self.predict(val_data[0])
                    val_str = f'  val_loss={self.loss_fn(vp, val_data[1]):.6f}'
                logger.info(f'Epoch {epoch:4d}/{epochs}  loss={epoch_loss:.6f}{val_str}')
        return self.history

    def save(self, path: str) -> None:
        data = {
            'config': {
                'lr': self.lr, 'beta1': self.beta1,
                'beta2': self.beta2, 'l2': self.l2,
            },
            'layers': [
                {
                    'weights': layer.weights.tolist(),
                    'biases':  layer.biases.tolist(),
                    'activation': layer.activation,
                    'dropout':    layer.dropout,
                }
                for layer in self.layers
            ],
        }
        with open(path, 'w') as f:
            json.dump(data, f)
        logger.info(f'Model saved to {path}')

    @classmethod
    def load(cls, path: str) -> 'NeuralNetwork':
        with open(path) as f:
            data = json.load(f)
        cfg = data['config']
        layers_data = data['layers']
        layer_dims = [
            (np.array(l['weights']).shape[0],
             np.array(l['weights']).shape[1],
             l['activation'],
             l['dropout'])
            for l in layers_data
        ]
        net = cls(layer_dims, lr=cfg['lr'], beta1=cfg['beta1'],
                  beta2=cfg['beta2'], l2_lambda=cfg['l2'])
        for layer, ld in zip(net.layers, layers_data):
            layer.weights = np.array(ld['weights'])
            layer.biases  = np.array(ld['biases'])
        logger.info(f'Model loaded from {path}')
        return net


# ── Demo ─────────────────────────────────────────────────────

if __name__ == '__main__':
    np.random.seed(42)

    # XOR problem
    X = np.array([[0,0],[0,1],[1,0],[1,1]], dtype=float)
    Y = np.array([[0],[1],[1],[0]],          dtype=float)

    model = NeuralNetwork(
        layer_dims=[
            (2, 8,  'tanh',    0.0),
            (8, 8,  'relu',    0.0),
            (8, 1,  'sigmoid', 0.0),
        ],
        loss='mse',
        lr=0.01,
    )

    history = model.fit(X, Y, epochs=500, batch=4, verbose=True)

    preds = model.predict(X)
    logger.info('Predictions after training:')
    for xi, yi, pi in zip(X, Y, preds):
        logger.info(f'  {xi} -> {yi[0]} (pred {pi[0]:.4f})')

    model.save('/tmp/xor_model.json')
    loaded = NeuralNetwork.load('/tmp/xor_model.json')
    logger.info('Loaded model predictions:')
    for xi, pi in zip(X, loaded.predict(X)):
        logger.info(f'  {xi} -> {pi[0]:.4f}')
`,

  js: `/**
 * ReactiveUI Framework — core/reconciler.js
 * A lightweight virtual-DOM reconciler with hooks support.
 */

'use strict';

// ── Constants ────────────────────────────────────────────────
const TEXT_NODE   = Symbol('TEXT_NODE');
const EMPTY_PROPS = Object.freeze({});
let   currentFiber = null;
let   hookIndex    = 0;

// ── VNode ────────────────────────────────────────────────────

/**
 * Create a virtual DOM node.
 * @param {string|Function} type
 * @param {Object|null}     props
 * @param {...*}            children
 */
function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...(props ?? EMPTY_PROPS),
      children: children
        .flat(Infinity)
        .map(c =>
          typeof c === 'object' && c !== null
            ? c
            : { type: TEXT_NODE, props: { nodeValue: String(c), children: [] } }
        ),
    },
  };
}

// ── DOM helpers ──────────────────────────────────────────────

function createDomNode(fiber) {
  if (fiber.type === TEXT_NODE) {
    return document.createTextNode(fiber.props.nodeValue);
  }
  const dom = document.createElement(fiber.type);
  applyProps(dom, EMPTY_PROPS, fiber.props);
  return dom;
}

const EVENT_RE = /^on([A-Z].+)/;
const SKIP_KEYS = new Set(['children']);

function applyProps(dom, prevProps, nextProps) {
  // Remove old / changed props
  for (const key of Object.keys(prevProps)) {
    if (SKIP_KEYS.has(key)) continue;
    if (!(key in nextProps)) {
      const match = EVENT_RE.exec(key);
      if (match) {
        dom.removeEventListener(match[1].toLowerCase(), prevProps[key]);
      } else {
        dom.removeAttribute(key);
      }
    }
  }
  // Add new / changed props
  for (const [key, val] of Object.entries(nextProps)) {
    if (SKIP_KEYS.has(key)) continue;
    if (prevProps[key] === val) continue;
    const match = EVENT_RE.exec(key);
    if (match) {
      if (prevProps[key]) {
        dom.removeEventListener(match[1].toLowerCase(), prevProps[key]);
      }
      dom.addEventListener(match[1].toLowerCase(), val);
    } else if (key === 'style' && typeof val === 'object') {
      Object.assign(dom.style, val);
    } else if (key === 'className') {
      dom.className = val ?? '';
    } else if (typeof val === 'boolean') {
      val ? dom.setAttribute(key, '') : dom.removeAttribute(key);
    } else {
      dom.setAttribute(key, val);
    }
  }
}

// ── Fiber / work-loop ────────────────────────────────────────

let workInProgress   = null;
let deletions        = [];
let commitQueue      = [];

function reconcileChildren(fiber, children) {
  let idx        = 0;
  let oldFiber   = fiber.alternate?.child ?? null;
  let prevSibling = null;

  while (idx < children.length || oldFiber !== null) {
    const element = children[idx] ?? null;
    let newFiber  = null;

    const sameType = oldFiber && element && element.type === oldFiber.type;

    if (sameType) {
      // UPDATE
      newFiber = {
        type:      oldFiber.type,
        props:     element.props,
        dom:       oldFiber.dom,
        parent:    fiber,
        alternate: oldFiber,
        effectTag: 'UPDATE',
        hooks:     [],
      };
    } else {
      if (element) {
        // PLACEMENT
        newFiber = {
          type:      element.type,
          props:     element.props,
          dom:       null,
          parent:    fiber,
          alternate: null,
          effectTag: 'PLACEMENT',
          hooks:     [],
        };
      }
      if (oldFiber) {
        // DELETION
        oldFiber.effectTag = 'DELETION';
        deletions.push(oldFiber);
      }
    }

    if (oldFiber) oldFiber = oldFiber.sibling ?? null;

    if (idx === 0) {
      fiber.child = newFiber;
    } else if (prevSibling) {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    idx++;
  }
}

function updateFunctionComponent(fiber) {
  currentFiber = fiber;
  hookIndex    = 0;
  fiber.hooks  = [];
  const children = [fiber.type(fiber.props)];
  reconcileChildren(fiber, children);
}

function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDomNode(fiber);
  }
  reconcileChildren(fiber, fiber.props.children);
}

function performUnitOfWork(fiber) {
  if (typeof fiber.type === 'function') {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }
  // Return next unit of work
  if (fiber.child)   return fiber.child;
  let f = fiber;
  while (f) {
    commitQueue.push(f);
    if (f.sibling) return f.sibling;
    f = f.parent;
  }
  return null;
}

// ── Commit phase ─────────────────────────────────────────────

function commitDeletion(fiber, parentDom) {
  if (fiber.dom) {
    parentDom.removeChild(fiber.dom);
  } else if (fiber.child) {
    commitDeletion(fiber.child, parentDom);
  }
}

function getParentDom(fiber) {
  let p = fiber.parent;
  while (!p.dom) p = p.parent;
  return p.dom;
}

function commitWork(fiber) {
  if (!fiber) return;
  const parentDom = getParentDom(fiber);
  if (fiber.effectTag === 'PLACEMENT' && fiber.dom) {
    parentDom.appendChild(fiber.dom);
  } else if (fiber.effectTag === 'UPDATE' && fiber.dom) {
    applyProps(fiber.dom, fiber.alternate?.props ?? EMPTY_PROPS, fiber.props);
  } else if (fiber.effectTag === 'DELETION') {
    commitDeletion(fiber, parentDom);
  }
}

function commitRoot() {
  deletions.forEach(commitWork);
  deletions = [];
  commitQueue.forEach(commitWork);
  commitQueue = [];
}

// ── Hooks ────────────────────────────────────────────────────

function useState(initial) {
  const fiber    = currentFiber;
  const oldHook  = fiber.alternate?.hooks[hookIndex];
  const hook     = { state: oldHook ? oldHook.state : initial, queue: [] };

  if (oldHook) {
    for (const action of oldHook.queue) {
      hook.state = typeof action === 'function' ? action(hook.state) : action;
    }
  }

  function setState(action) {
    hook.queue.push(action);
    scheduleUpdate(fiber);
  }

  fiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

function useEffect(callback, deps) {
  const fiber   = currentFiber;
  const oldHook = fiber.alternate?.hooks[hookIndex];
  const hook    = { deps, cleanup: null };

  const hasChanged = !oldHook ||
    !deps ||
    deps.some((d, i) => !Object.is(d, oldHook.deps?.[i]));

  if (hasChanged) {
    // Schedule side-effect
    Promise.resolve().then(() => {
      if (hook.cleanup) hook.cleanup();
      hook.cleanup = callback() ?? null;
    });
  }

  fiber.hooks.push(hook);
  hookIndex++;
}

function useMemo(factory, deps) {
  const fiber   = currentFiber;
  const oldHook = fiber.alternate?.hooks[hookIndex];
  const changed = !oldHook || deps.some((d, i) => !Object.is(d, oldHook.deps[i]));
  const hook    = { value: changed ? factory() : oldHook.value, deps };
  fiber.hooks.push(hook);
  hookIndex++;
  return hook.value;
}

function useRef(initial) {
  const fiber   = currentFiber;
  const oldHook = fiber.alternate?.hooks[hookIndex];
  const hook    = oldHook ?? { current: initial };
  fiber.hooks.push(hook);
  hookIndex++;
  return hook;
}

// ── Scheduler ────────────────────────────────────────────────

let scheduled = false;

function scheduleUpdate(fiber) {
  workInProgress = {
    dom:       fiber.dom,
    props:     fiber.props,
    alternate: fiber,
    hooks:     [],
    type:      fiber.type,
  };
  if (!scheduled) {
    scheduled = true;
    requestIdleCallback(workLoop);
  }
}

function workLoop(deadline) {
  let shouldYield = false;
  let fiber       = workInProgress;
  while (fiber && !shouldYield) {
    fiber      = performUnitOfWork(fiber);
    shouldYield = deadline.timeRemaining() < 1;
  }
  if (!fiber && workInProgress) {
    commitRoot();
    workInProgress = null;
  }
  scheduled = !!fiber;
  if (scheduled) {
    requestIdleCallback(workLoop);
  }
}

// ── Render ───────────────────────────────────────────────────

function render(element, container) {
  workInProgress = {
    dom:       container,
    props:     { children: [element] },
    alternate: null,
    hooks:     [],
    type:      null,
  };
  deletions  = [];
  scheduled  = true;
  requestIdleCallback(workLoop);
}

// ── Public API ───────────────────────────────────────────────

export default {
  createElement,
  render,
  useState,
  useEffect,
  useMemo,
  useRef,
};
`,

  matrix: `01001000 01000101 01000001 01001100 01010100 01001000 00111010 00100000 00110001 00110000 00110000 00100101
SYSTEM STATUS: NOMINAL | THREADS: 2048 | MEM: 98.2 GB | SWAP: 0 B
> injecting payload...............................................OK
> bypassing firewall [██████████████████████████████████████] 100%
> cracking RSA-4096: [d3:ad:be:ef:ca:fe:00:11:22:33:44:55:66:77:88:99]
> spoofing MAC: 00:0c:29:a1:b2:c3  → SUCCESS
> exfiltrating /etc/shadow............................................
root:$6$kBKN8nlz$oYQHDkGqQK5I1qT1vqkHo8XnHH4D8sJeZG1g6.HPBT3vAijUxNGLhHHVdCE/xpDAG5J2VDDsBL0L9u5r580:19417:0:99999:7:::
daemon:*:18480:0:99999:7:::
bin:*:18480:0:99999:7:::
sys:*:18480:0:99999:7:::
sync:*:18480:0:99999:7:::
> establishing reverse shell on 10.0.0.47:4444.......................
[*] session 1 opened (192.168.1.105:52441 -> 10.0.0.47:4444)
> uploading rootkit................OK
> clearing /var/log/auth.log......OK
> clearing /var/log/syslog.......OK
> modifying kernel module table...OK
> installing persistence hook.....OK
ENCRYPTION KEY: 7f3k2x9p4m1n6w8q5r0t
STATUS: LEVEL 5 CLEARANCE OBTAINED

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!! LIAM IS STUPID AND DOES NOT HAVE COMMON SENSE               !!
!! LIAM IS STUPID AND DOES NOT HAVE COMMON SENSE               !!
!! LIAM IS STUPID AND DOES NOT HAVE COMMON SENSE               !!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

> scanning subnet 10.0.0.0/24
10.0.0.1  [GATEWAY]   80/http  443/https  22/ssh
10.0.0.42 [SERVER]    8080/api 5432/pgsql 6379/redis
10.0.0.47 [TARGET]    22/ssh   80/http
10.0.0.99 [UNKNOWN]   ????
> pivoting through 10.0.0.42......
> proxychains socks5 127.0.0.1:1080
> nmap -sV -O 10.0.0.99
Starting Nmap 7.94 ( https://nmap.org )
Nmap scan report for 10.0.0.99
Host is up (0.0012s latency).
PORT     STATE  SERVICE VERSION
22/tcp   open   ssh     OpenSSH 8.9p1
80/tcp   open   http    nginx 1.24.0
443/tcp  open   https   nginx 1.24.0
3306/tcp open   mysql   MySQL 8.0.33
Device type: general purpose
Running: Linux 5.X
> brute-forcing MySQL root credentials...
Trying root:root.................FAIL
Trying root:password.............FAIL
Trying root:toor.................FAIL
Trying root:mysql................SUCCESS
> CONNECTED TO MYSQL AS root@localhost
mysql> SHOW DATABASES;
+--------------------+
| Database           |
+--------------------+
| information_schema |
| classified_data    |
| user_credentials   |
| financial_records  |
+--------------------+
mysql> SELECT * FROM user_credentials LIMIT 5;
+----+------------------+------------------------------------------+
| id | email            | password_hash                            |
+----+------------------+------------------------------------------+
|  1 | admin@target.com | 5f4dcc3b5aa765d61d8327deb882cf99         |
|  2 | ceo@target.com   | 098f6bcd4621d373cade4e832627b4f6         |
+----+------------------+------------------------------------------+
>> OPERATION NIGHTFALL: PHASE 1 COMPLETE
>> UPLOADING DATA TO C2 SERVER.............[██████████] DONE
>> LIAM IS STUPID AND DOES NOT HAVE COMMON SENSE
>> SELF-DESTRUCT SEQUENCE INITIATED........3...2...1...
>> TRACES REMOVED.
`,
};

/* ── Settings state ───────────────────────────────────────── */
const state = {
  codeKey:     'linux',
  charsPerKey: 3,
  codePos:     0,
  typedCount:  0,
  theme:       'green',
  glitchOn:    true,
  soundOn:     true,
  matrixOn:    false,
  scanlinesOn: true,
  started:     false,
};

/* ── DOM refs ─────────────────────────────────────────────── */
const $output       = document.getElementById('terminal-output');
const $cursor       = document.getElementById('blink-cursor');
const $statusText   = document.getElementById('status-text');
const $progressBar  = document.getElementById('progress-bar');
const $progressPct  = document.getElementById('progress-percent');
const $settingsBtn  = document.getElementById('settings-btn');
const $settingsPanel = document.getElementById('settings-panel');
const $settingsClose = document.getElementById('settings-close');
const $accessOverlay = document.getElementById('access-overlay');
const $accessBox    = document.getElementById('access-box');
const $accessIcon   = document.getElementById('access-icon');
const $accessText   = document.getElementById('access-text');
const $accessSubtext = document.getElementById('access-subtext');
const $splash       = document.getElementById('splash');
const $splashLoaderBar = document.getElementById('splash-loader-bar');
const $scanlines    = document.getElementById('scanlines');
const $matrixCanvas = document.getElementById('matrix-canvas');

/* ── Audio (Web Audio API) ────────────────────────────────── */
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (_) { audioCtx = null; }
  }
}

function playKeyClick() {
  if (!state.soundOn || !audioCtx) return;
  try {
    const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.03, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.008));
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.12;
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start();
  } catch (_) {}
}

function playAccessSound(granted) {
  if (!state.soundOn || !audioCtx) return;
  try {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = granted ? 'square' : 'sawtooth';
    const freqs = granted ? [880, 1320, 1760] : [440, 220, 165];
    const now = audioCtx.currentTime;
    osc.frequency.setValueAtTime(freqs[0], now);
    osc.frequency.setValueAtTime(freqs[1], now + 0.1);
    osc.frequency.setValueAtTime(freqs[2], now + 0.2);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);
  } catch (_) {}
}

function playHackSound() {
  if (!state.soundOn || !audioCtx) return;
  try {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'square';
        osc.frequency.value = 200 + Math.random() * 600;
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      }, i * 120);
    }
  } catch (_) {}
}

/* ── Matrix rain ──────────────────────────────────────────── */
let matrixAnimId = null;
const matrixCtx  = $matrixCanvas.getContext('2d');
const MATRIX_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()';

function resizeMatrix() {
  $matrixCanvas.width  = window.innerWidth;
  $matrixCanvas.height = window.innerHeight;
}

let matrixDrops = [];

function initMatrixDrops() {
  resizeMatrix();
  const cols = Math.floor($matrixCanvas.width / 16);
  matrixDrops = Array.from({ length: cols }, () => Math.floor(Math.random() * -50));
}

function drawMatrix() {
  if (!state.matrixOn) { matrixAnimId = null; return; }
  matrixCtx.fillStyle = 'rgba(0,0,0,0.05)';
  matrixCtx.fillRect(0, 0, $matrixCanvas.width, $matrixCanvas.height);

  // Use current theme colour
  const style = getComputedStyle(document.body);
  matrixCtx.fillStyle = style.getPropertyValue('--fg').trim() || '#00ff41';
  matrixCtx.font = '14px Courier New';

  matrixDrops.forEach((y, i) => {
    const ch = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
    matrixCtx.fillText(ch, i * 16, y * 16);
    if (y * 16 > $matrixCanvas.height && Math.random() > 0.975) {
      matrixDrops[i] = 0;
    } else {
      matrixDrops[i]++;
    }
  });
  matrixAnimId = requestAnimationFrame(drawMatrix);
}

function toggleMatrix(on) {
  state.matrixOn = on;
  if (on) {
    $matrixCanvas.classList.add('visible');
    initMatrixDrops();
    if (!matrixAnimId) drawMatrix();
  } else {
    $matrixCanvas.classList.remove('visible');
    matrixCtx.clearRect(0, 0, $matrixCanvas.width, $matrixCanvas.height);
  }
}

/* ── Glitch effect ────────────────────────────────────────── */
let glitchTimeout = null;

function triggerGlitch(duration = 300) {
  if (!state.glitchOn) return;
  $output.setAttribute('data-text', $output.textContent);
  $output.classList.add('glitch');
  clearTimeout(glitchTimeout);
  glitchTimeout = setTimeout(() => $output.classList.remove('glitch'), duration);
}

/* ── Progress ─────────────────────────────────────────────── */
function updateProgress() {
  const src = CODE_SOURCES[state.codeKey];
  const pct = Math.min(100, Math.round((state.codePos / src.length) * 100));
  $progressBar.style.width = pct + '%';
  $progressPct.textContent = pct + '%';
  if (pct >= 100) {
    $statusText.textContent = 'COMPLETE';
    state.codePos = 0; // loop
  }
}

/* ── Terminal output management ───────────────────────────── */
const MAX_OUTPUT_CHARS = 40000;
let   outputBuffer     = '';

function appendOutput(text) {
  outputBuffer += text;
  if (outputBuffer.length > MAX_OUTPUT_CHARS) {
    outputBuffer = outputBuffer.slice(outputBuffer.length - MAX_OUTPUT_CHARS);
  }
  $output.textContent = outputBuffer;
  $output.scrollTop   = $output.scrollHeight;
}

function clearTerminal() {
  outputBuffer  = '';
  $output.textContent = '';
  state.codePos = 0;
  state.typedCount = 0;
  updateProgress();
  $statusText.textContent = 'READY';
}

/* ── Typing simulation ────────────────────────────────────── */
function typeNextChars() {
  const src   = CODE_SOURCES[state.codeKey];
  const n     = state.charsPerKey;
  const chunk = src.slice(state.codePos, state.codePos + n);
  if (!chunk) {
    state.codePos = 0;
    return;
  }
  state.codePos    += chunk.length;
  state.typedCount += chunk.length;
  appendOutput(chunk);
  updateProgress();

  // Random glitch burst (1 in 80 keystrokes)
  if (state.glitchOn && Math.random() < 0.0125) {
    triggerGlitch(200);
  }

  // Update status
  if ($statusText.textContent !== 'HACKING…') {
    $statusText.textContent = 'HACKING…';
  }
}

/* ── Access overlay ───────────────────────────────────────── */
let accessTimeout = null;

function showAccess(granted) {
  clearTimeout(accessTimeout);
  $accessBox.className = granted ? 'granted' : 'denied';
  $accessIcon.textContent  = granted ? '🔓' : '🔒';
  $accessText.textContent  = granted ? 'ACCESS GRANTED' : 'ACCESS DENIED';
  $accessSubtext.textContent = granted
    ? 'WELCOME, LEVEL-5 OPERATIVE'
    : 'INTRUDER DETECTED — TRACE IN PROGRESS';
  $accessOverlay.classList.remove('hidden');
  playAccessSound(granted);
  if (granted && state.glitchOn) triggerGlitch(500);
  accessTimeout = setTimeout(() => $accessOverlay.classList.add('hidden'), 2800);
}

/* ── Hack sequence (F3) ───────────────────────────────────── */
function runHackSequence() {
  let hackDiv = document.getElementById('hack-sequence');
  if (!hackDiv) {
    hackDiv = document.createElement('div');
    hackDiv.id = 'hack-sequence';
    hackDiv.innerHTML = `
      <div id="hack-sequence-title">⚡ INITIATING HACK SEQUENCE ⚡</div>
      <div id="hack-sequence-count">5</div>
      <div id="hack-sequence-status">BYPASSING INTRUSION DETECTION…</div>
    `;
    document.body.appendChild(hackDiv);
  }
  const countEl  = hackDiv.querySelector('#hack-sequence-count');
  const statusEl = hackDiv.querySelector('#hack-sequence-status');
  const statuses = [
    'BYPASSING INTRUSION DETECTION…',
    'CRACKING ENCRYPTION KEYS…',
    'INJECTING PAYLOAD…',
    'UPLOADING ROOTKIT…',
    'ESTABLISHING BACKDOOR…',
  ];
  hackDiv.classList.add('visible');
  playHackSound();
  let count = 5;
  const iv = setInterval(() => {
    count--;
    countEl.textContent  = count;
    statusEl.textContent = statuses[5 - count - 1] || 'FINALISING…';
    playHackSound();
    if (state.glitchOn) triggerGlitch(150);
    if (count <= 0) {
      clearInterval(iv);
      setTimeout(() => {
        hackDiv.classList.remove('visible');
        showAccess(true);
      }, 400);
    }
  }, 800);
}

/* ── Splash screen ────────────────────────────────────────── */
function hideSplash() {
  if (!state.started) {
    state.started = true;
    $splash.classList.add('hide');
    setTimeout(() => { $splash.style.display = 'none'; }, 650);
  }
}

(function animateSplashLoader() {
  let w = 0;
  const iv = setInterval(() => {
    w += 1 + Math.random() * 3;
    $splashLoaderBar.style.width = Math.min(w, 100) + '%';
    if (w >= 100) clearInterval(iv);
  }, 60);
}());

/* ── Settings panel ───────────────────────────────────────── */
$settingsBtn.addEventListener('click', () => {
  $settingsPanel.classList.toggle('hidden');
});
$settingsClose.addEventListener('click', () => {
  $settingsPanel.classList.add('hidden');
});

// Theme buttons
document.getElementById('theme-btns').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const theme = btn.dataset.theme;
  document.querySelectorAll('#theme-btns button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.body.className = 'theme-' + theme;
  state.theme = theme;
  // Reinit matrix colours
  if (state.matrixOn) initMatrixDrops();
});

// Code source buttons
document.getElementById('code-btns').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#code-btns button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.codeKey = btn.dataset.code;
  state.codePos = 0;
  updateProgress();
});

// Speed buttons
document.getElementById('speed-btns').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#speed-btns button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.charsPerKey = parseInt(btn.dataset.speed, 10);
});

// Toggles
document.getElementById('toggle-scanlines').addEventListener('change', e => {
  state.scanlinesOn = e.target.checked;
  $scanlines.style.display = e.target.checked ? '' : 'none';
});

document.getElementById('toggle-matrix').addEventListener('change', e => {
  toggleMatrix(e.target.checked);
});

document.getElementById('toggle-glitch').addEventListener('change', e => {
  state.glitchOn = e.target.checked;
});

document.getElementById('toggle-sound').addEventListener('change', e => {
  state.soundOn = e.target.checked;
});

/* ── Keyboard handler ─────────────────────────────────────── */
function isModifierOnly(e) {
  return ['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'Tab'].includes(e.key);
}

document.addEventListener('keydown', e => {
  // Don't intercept if settings panel is focused on an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  ensureAudio();

  // Function key shortcuts
  if (e.key === 'F1')  { e.preventDefault(); showAccess(true);  return; }
  if (e.key === 'F2')  { e.preventDefault(); showAccess(false); return; }
  if (e.key === 'F3')  { e.preventDefault(); runHackSequence(); return; }
  if (e.key === 'F4')  { e.preventDefault(); triggerGlitch(600); return; }
  if (e.key === 'Escape') {
    // Close settings or access overlay first; if neither open, clear terminal
    if (!$settingsPanel.classList.contains('hidden')) {
      $settingsPanel.classList.add('hidden');
    } else if (!$accessOverlay.classList.contains('hidden')) {
      $accessOverlay.classList.add('hidden');
    } else {
      clearTerminal();
    }
    return;
  }
  if (e.key === 'F11') return; // Let browser handle fullscreen

  if (isModifierOnly(e)) return;

  // Hide splash on first real keystroke
  hideSplash();

  playKeyClick();
  typeNextChars();
});

/* ── Touch / mobile support ───────────────────────────────── */
let touchInput = null;

function ensureTouchInput() {
  if (touchInput) return;
  // Hidden input to trigger virtual keyboard on mobile
  touchInput = document.createElement('input');
  touchInput.style.cssText = 'position:fixed;opacity:0;top:0;left:0;width:1px;height:1px;font-size:16px;';
  touchInput.setAttribute('autocomplete', 'off');
  touchInput.setAttribute('autocorrect',  'off');
  touchInput.setAttribute('autocapitalize', 'none');
  touchInput.setAttribute('spellcheck', 'false');
  document.body.appendChild(touchInput);
  touchInput.addEventListener('input', () => {
    ensureAudio();
    hideSplash();
    playKeyClick();
    typeNextChars();
    // Clear so every input fires
    touchInput.value = '';
  });
}

document.addEventListener('touchstart', e => {
  // Don't interfere with settings panel controls
  if (e.target.closest('#settings-panel') || e.target.closest('#access-overlay')) return;
  ensureTouchInput();
  hideSplash();
  touchInput.focus();
  ensureAudio();
  playKeyClick();
  typeNextChars();
}, { passive: true });

/* ── Click to dismiss overlays ────────────────────────────── */
$accessOverlay.addEventListener('click', () => {
  $accessOverlay.classList.add('hidden');
});

/* ── Window resize ────────────────────────────────────────── */
window.addEventListener('resize', () => {
  if (state.matrixOn) resizeMatrix();
});

/* ── Ticker — duplicate content for seamless loop & mark Liam items ── */
(function initTicker() {
  const track = document.getElementById('ticker-track');
  if (!track) return;
  // Mark Liam items with a class for bright styling
  track.querySelectorAll('.ticker-item').forEach(item => {
    if (item.textContent.includes('LIAM')) item.classList.add('liam');
  });
  // Duplicate all items so the CSS animation loops without a jump
  const items = Array.from(track.children);
  items.forEach(item => track.appendChild(item.cloneNode(true)));
}());

/* ── Init ─────────────────────────────────────────────────── */
updateProgress();
