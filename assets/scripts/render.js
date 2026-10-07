"use strict";

function $(id) {
    return document.getElementById(id);
}

function h(tag, props, children) {
    var node = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined || value === false) {
            return;
        }
        if (key === "class") {
            node.className = value;
        } else if (key === "text") {
            node.textContent = value;
        } else if (key === "on") {
            Object.keys(value).forEach(function (event) {
                node.addEventListener(event, value[event]);
            });
        } else if (key === "data") {
            Object.keys(value).forEach(function (name) {
                node.dataset[name] = value[name];
            });
        } else {
            node.setAttribute(key, value);
        }
    });
    (children || []).forEach(function (child) {
        if (child === null || child === undefined || child === false) {
            return;
        }
        node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
}

function clear(node) {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

function showToast(type, title, text) {
    var container = $("toasts");
    if (!container) {
        return;
    }
    var node = h("div", { class: "toast toast--" + type }, [
        h("div", { class: "toast_body" }, [
            h("p", { class: "toast_title", text: title }),
            text ? h("p", { class: "toast_text", text: text }) : null
        ]),
        h("button", {
            class: "toast_close",
            type: "button",
            text: "×",
            "aria-label": "Закрыть",
            on: {
                click: function () {
                    node.remove();
                }
            }
        })
    ]);
    container.appendChild(node);
    window.setTimeout(function () {
        if (node.parentNode) {
            node.remove();
        }
    }, type === "error" || type === "warning" ? 7000 : 4500);
}

function openModal(title, body, foot) {
    var modal = $("modal");
    $("modalTitle").textContent = title;
    clear($("modalBody"));
    clear($("modalFoot"));
    $("modalBody").appendChild(body);
    (foot || []).forEach(function (node) {
        $("modalFoot").appendChild(node);
    });
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    window.setTimeout(function () {
        var focusable = modal.querySelector("input:not([type=hidden]), select, textarea");
        if (focusable) {
            focusable.focus();
        }
    }, 40);
}

function closeModal() {
    if ($("modal").hidden) {
        return;
    }
    $("modal").hidden = true;
    clear($("modalBody"));
    clear($("modalFoot"));
    document.body.style.overflow = "";
}

function confirmDialog(title, text, confirmLabel, onConfirm) {
    openModal(title, h("p", { text: text }), [
        h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Отмена",
            on: { click: closeModal }
        }),
        h("span", { class: "spacer" }),
        h("button", {
            class: "btn btn--primary",
            type: "button",
            text: confirmLabel,
            on: {
                click: function () {
                    closeModal();
                    onConfirm();
                }
            }
        })
    ]);
}

function statusColor(id) {
    var colors = {
        backlog: "#9c8e93",
        todo: "#b4a18a",
        progress: "#5c1f2d",
        review: "#a65a6b",
        done: "#4e7a5a"
    };
    return colors[id] || "#9c8e93";
}

function priorityColor(id) {
    var colors = {
        low: "#8b808f",
        medium: "#b0904a",
        high: "#bf6536",
        critical: "#a62b3c"
    };
    return colors[id] || "#8b808f";
}

function priorityBadge(task) {
    return h("span", {
        class: "badge badge--" + task.priority,
        text: priorityById(task.priority).title
    });
}

function statusBadge(task) {
    var classes = "badge";
    if (task.status === "progress") {
        classes += " badge--progress";
    } else if (task.status === "done") {
        classes += " badge--done";
    } else if (task.status === "review") {
        classes += " badge--review";
    } else if (task.status === "todo") {
        classes += " badge--todo";
    } else {
        classes += " badge--backlog";
    }
    return h("span", { class: classes, text: statusById(task.status).title });
}

function dueBadge(task) {
    var label = formatDate(task.dueDate);
    if (isOverdue(task)) {
        return h("span", { class: "badge badge--overdue", text: "Просрочено · " + label });
    }
    if (isDueSoon(task)) {
        return h("span", { class: "badge badge--medium", text: "Скоро · " + label });
    }
    if (!task.dueDate) {
        return h("span", { class: "badge badge--soft", text: "Без срока" });
    }
    return h("span", { class: "badge badge--soft", text: "До " + label });
}

function blockedAlert(task) {
    var blockers = unmetDependencies(task);
    if (!blockers.length || task.status === "done") {
        return null;
    }
    return h("p", {
        class: "alert",
        text: "Нельзя начать: сначала завершите " + blockers.map(function (item) {
            return "«" + item.title + "»";
        }).join(", ")
    });
}

function statusSelect(task) {
    var select = h("select", {
        class: "btn--icon",
        "aria-label": "Изменить статус",
        on: {
            change: function () {
                moveTask(task.id, select.value);
                renderAll();
            }
        }
    }, STATUSES.map(function (status) {
        return h("option", { value: status.id, text: status.title });
    }));
    select.value = task.status;
    return select;
}

function progressBar(percent) {
    return h("div", { class: "progress" }, [
        h("div", { class: "progress_bar", style: "width:" + percent + "%" })
    ]);
}

function emptyState(text) {
    return h("p", { class: "empty", text: text });
}

function metricCard(value, label, modifier) {
    return h("div", { class: "stat-card" + (modifier ? " " + modifier : "") }, [
        h("span", { class: "stat-card_value", text: String(value) }),
        h("span", { class: "stat-card_label", text: label })
    ]);
}

function barRow(label, value, total, color) {
    var percent = total ? Math.round((value / total) * 100) : 0;
    return h("div", { class: "bar-row" }, [
        h("span", { text: label }),
        h("div", { class: "bar" }, [
            h("div", { class: "bar_fill", style: "width:" + percent + "%;background:" + color })
        ]),
        h("span", { class: "bar_value", text: String(value) })
    ]);
}

function pageHead(title, subtitle, side) {
    return h("div", { class: "page-head" }, [
        h("div", {}, [
            h("h2", { text: title }),
            subtitle ? h("p", { text: subtitle }) : null
        ]),
        side || null
    ]);
}

function taskListRow(task, side) {
    return h("div", { class: "list-row" }, [
        h("span", {
            class: "list-row_title",
            text: task.title,
            on: {
                click: function () {
                    openTaskDetails(task.id);
                }
            }
        }),
        h("span", { class: "list-row_side" }, side)
    ]);
}

function taskCard(task) {
    var classes = ["task"];
    if (task.status === "done") {
        classes.push("is-done");
    }
    if (isOverdue(task)) {
        classes.push("task--overdue");
    } else if (task.priority === "critical") {
        classes.push("task--critical");
    } else if (task.priority === "high") {
        classes.push("task--high");
    }
    if (isBlocked(task)) {
        classes.push("task--blocked");
    }

    var meta = [priorityBadge(task), dueBadge(task)];
    if (task.estimate) {
        meta.push(h("span", { class: "badge badge--soft", text: task.estimate + " ч" }));
    }
    if (isBlocked(task)) {
        meta.push(h("span", { class: "badge badge--blocked", text: "Заблокирована" }));
    }

    var deps = dependenciesOf(task);
    var depsNode = deps.length ? h("div", { class: "deps" }, [
        h("span", { text: "Зависит от:" }),
        h("div", { class: "chips" }, deps.map(function (dep) {
            return h("span", {
                class: "chip",
                text: dep.title + (dep.status === "done" ? " · готово" : "")
            });
        }))
    ]) : null;

    var card = h("article", {
        class: classes.join(" "),
        data: { id: task.id },
draggable: "true"
    }, [
        h("p", {
            class: "task_title",
            text: task.title,
            on: {
                click: function () {
                    openTaskDetails(task.id);
                }
            }
        }),
        h("p", { class: "faint", text: projectById(task.projectId).name }),
        task.description ? h("p", { class: "task_desc", text: task.description }) : null,
        h("div", { class: "task_meta" }, meta),
        depsNode,
        blockedAlert(task),
        h("div", { class: "task_actions" }, [
            statusSelect(task),
            h("button", {
                class: "btn btn--icon",
                type: "button",
                text: "Изменить",
                on: {
                    click: function () {
                        openTaskForm(task.id);
                    }
                }
            }),
            h("button", {
                class: "btn btn--icon",
                type: "button",
                text: "Удалить",
                on: {
                    click: function () {
                        askRemoveTask(task.id);
                    }
                }
            })
        ])
    ]);

    card.addEventListener("dragstart", function (event) {
        event.dataTransfer.setData("text/plain", task.id);
        card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", function () {
        card.classList.remove("is-dragging");
    });

    return card;
}

function renderSidebar() {
    var container = $("projectList");
    if (!container) {
        return;
    }
    clear(container);

    container.appendChild(projectButton("all", "Все задачи", "#5c1f2d", state.tasks.length));

    state.projects.forEach(function (project) {
        var count = state.tasks.filter(function (task) {
            return task.projectId === project.id;
        }).length;
        container.appendChild(projectButton(project.id, project.name, project.color, count));
    });

    container.appendChild(h("button", {
        class: "project",
        type: "button",
        on: {
            click: function () {
                openProjectForm();
            }
        }
    }, [
        h("span", { class: "project_dot", style: "background:#d2a79e" }),
        h("span", { class: "truncate", text: "Новый проект" })
    ]));
}

function projectButton(id, title, color, count) {
    return h("button", {
        class: "project" + (state.project === id ? " is-active" : ""),
        type: "button",
        on: {
            click: function () {
                state.project = id;
                renderAll();
            }
        }
    }, [
        h("span", { class: "project_dot", style: "background:" + color }),
        h("span", { class: "truncate", text: title }),
        h("span", { class: "project_count", text: String(count) })
    ]);
}

function renderUser() {
    if (!state.user) {
        return;
    }
    $("userName").textContent = state.user.name;
    $("userRole").textContent = state.user.role;
    $("userAvatar").textContent = state.user.initials;
}

function renderOverview() {
    var tasks = visibleTasks();
    var stats = computeStats(tasks);
    var overdue = tasks.filter(isOverdue);
    var blocked = tasks.filter(function (task) {
        return isBlocked(task);
    });
    var soon = tasks.filter(isDueSoon).sort(function (a, b) {
        return String(a.dueDate).localeCompare(String(b.dueDate));
    });
    var important = tasks.filter(function (task) {
        return isHighPriority(task) && task.status !== "done";
    }).sort(function (a, b) {
        return priorityWeight(b.priority) - priorityWeight(a.priority);
    });

    var attention = overdue.concat(blocked.filter(function (task) {
        return overdue.indexOf(task) === -1;
    }));

    var metrics = h("div", { class: "grid-cards" }, [
        metricCard(stats.total, "Всего задач"),
        metricCard(stats.progress + "%", "Выполнено", "stat-card--ok"),
        metricCard(stats.active, "В работе и планах"),
        metricCard(stats.overdue, "Просрочено", stats.overdue ? "stat-card--alert" : ""),
        metricCard(stats.blocked, "Заблокировано", stats.blocked ? "stat-card--alert" : ""),
        metricCard(stats.highPriority, "Высокий приоритет", stats.highPriority ? "stat-card--alert" : "")
    ]);

    var progressCard = h("div", { class: "card" }, [
        h("p", { class: "card_title", text: "Прогресс проекта" }),
        h("div", { class: "progress-row" }, [
            h("div", { class: "progress-row_head" }, [
                h("span", { text: "Завершено " + stats.done + " из " + stats.total + " задач" }),
                h("span", { text: stats.progress + "%" })
            ]),
            progressBar(stats.progress)
        ]),
        h("div", { class: "progress-row", style: "margin-top:14px" }, [
            h("div", { class: "progress-row_head" }, [
                h("span", { text: "Часы: " + stats.hoursDone + " из " + stats.hoursTotal }),
                h("span", { text: hoursPercent(stats) + "%" })
            ]),
            progressBar(hoursPercent(stats))
        ])
    ]);

    var attentionCard = h("div", { class: "card" }, [
        h("p", { class: "card_title", text: "Требует внимания" }),
        attention.length ? h("div", { class: "list-block" }, attention.slice(0, 6).map(function (task) {
            return taskListRow(task, [
                isOverdue(task) ? h("span", { class: "badge badge--overdue", text: "Просрочено" }) : null,
                isBlocked(task) ? h("span", { class: "badge badge--blocked", text: "Заблокирована" }) : null,
                h("span", { text: formatDate(task.dueDate) })
            ]);
        })) : h("p", { class: "muted", text: "Просроченных и заблокированных задач нет." })
    ]);

    var soonCard = h("div", { class: "card" }, [
        h("p", { class: "card_title", text: "Ближайшие сроки" }),
        soon.length ? h("div", { class: "list-block" }, soon.slice(0, 6).map(function (task) {
            return taskListRow(task, [
                priorityBadge(task),
                h("span", { text: dueHint(task) })
            ]);
        })) : h("p", { class: "muted", text: "На ближайшие дни срочных задач нет." })
    ]);

    var importantCard = h("div", { class: "card" }, [
        h("p", { class: "card_title", text: "Высокий и критический приоритет" }),
        important.length ? h("div", { class: "list-block" }, important.slice(0, 8).map(function (task) {
            return taskListRow(task, [
                statusBadge(task),
                h("span", { text: projectById(task.projectId).name })
            ]);
        })) : h("p", { class: "muted", text: "Задач с высоким приоритетом нет." })
    ]);

    var projectsCard = h("div", { class: "card" }, [
        h("p", { class: "card_title", text: "Прогресс по проектам" }),
        h("div", { class: "bars" }, state.projects.map(function (project) {
            var data = stats.byProject[project.id] || { total: 0, done: 0 };
            var percent = data.total ? Math.round((data.done / data.total) * 100) : 0;
            return h("div", { class: "bar-row" }, [
                h("span", { text: project.name }),
                h("div", { class: "bar" }, [
                    h("div", {
                        class: "bar_fill",
                        style: "width:" + percent + "%;background:" + project.color
                    })
                ]),
                h("span", { class: "bar_value", text: percent + "%" })
            ]);
        }))
    ]);

    return h("div", { class: "view" }, [
        pageHead(
            "Обзор проекта",
            state.project === "all"
                ? "Сводка по всем проектам рабочего пространства"
                : "Проект: " + projectById(state.project).name,
            h("button", {
                class: "btn btn--primary",
                type: "button",
                text: "Новая задача",
                on: {
                    click: function () {
                        openTaskForm(null);
                    }
                }
            })
        ),
        metrics,
        h("div", { class: "two-col", style: "margin-bottom:16px" }, [progressCard, attentionCard]),
        h("div", { class: "two-col" }, [soonCard, importantCard]),
        h("div", { style: "margin-top:16px" }, [projectsCard])
    ]);
}

function hoursPercent(stats) {
    return stats.hoursTotal ? Math.round((stats.hoursDone / stats.hoursTotal) * 100) : 0;
}
function renderList() {
    var tasks = visibleTasks();
    var rows = tasks.map(function (task) {
        var deps = dependenciesOf(task);
        return h("tr", {}, [
            h("td", {}, [
                h("span", {
                    class: "table_title",
                    text: task.title,
                    on: {
                        click: function () {
                            openTaskDetails(task.id);
                        }
                    }
                }),
                deps.length ? h("span", {
                    class: "faint",
                    style: "display:block;font-size:11.5px",
                    text: "зависит от: " + deps.map(function (dep) {
                        return dep.title;
                    }).join(", ")
                }) : null
            ]),
            h("td", { class: "muted", text: projectById(task.projectId).name }),
            h("td", {}, [priorityBadge(task)]),
            h("td", {}, [statusBadge(task)]),
            h("td", {}, [
                h("span", {
                    class: isOverdue(task) ? "is-overdue-text" : "",
                    text: formatDate(task.dueDate)
                }),
                h("span", {
                    class: "faint",
                    style: "display:block;font-size:11.5px",
                    text: dueHint(task)
                })
            ]),
            h("td", { class: "muted", text: task.estimate ? task.estimate + " ч" : "—" }),
            h("td", {}, [
                h("div", { class: "table_actions" }, [
                    h("button", {
                        class: "btn btn--icon",
                        type: "button",
                        text: "Изменить",
                        on: {
                            click: function () {
                                openTaskForm(task.id);
                            }
                        }
                    }),
                    h("button", {
                        class: "btn btn--icon",
                        type: "button",
                        text: "Удалить",
                        on: {
                            click: function () {
                                askRemoveTask(task.id);
                            }
                        }
                    })
                ])
            ])
        ]);
    });

    var table = h("div", { class: "table-wrap" }, [
        h("table", { class: "table" }, [
            h("thead", {}, [
                h("tr", {}, [
                    h("th", { text: "Задача" }),
                    h("th", { text: "Проект" }),
                    h("th", { text: "Приоритет" }),
                    h("th", { text: "Статус" }),
                    h("th", { text: "Срок" }),
                    h("th", { text: "Оценка" }),
                    h("th", { style: "text-align:right", text: "Действия" })
                ])
            ]),
            h("tbody", {}, rows)
        ])
    ]);

    return h("div", { class: "view" }, [
        pageHead("Список задач", "Найдено задач: " + tasks.length),
        renderToolbar(),
        rows.length ? table : emptyState("Под выбранные условия задачи не найдены.")
    ]);
}

function renderToolbar() {
    return h("div", { class: "toolbar" }, [
        filterSelect("Проект", "project", [{ id: "all", title: "Все проекты" }].concat(
            state.projects.map(function (project) {
                return { id: project.id, title: project.name };
            })
        )),
        filterSelect("Приоритет", "priority", [{ id: "all", title: "Любой приоритет" }].concat(
            PRIORITIES.map(function (priority) {
                return { id: priority.id, title: priority.title };
            })
        )),
        filterSelect("Статус", "status", [{ id: "all", title: "Любой статус" }].concat(
            STATUSES.map(function (status) {
                return { id: status.id, title: status.title };
            })
        )),
        filterSelect("Сортировка", "sort", [
            { id: "priority", title: "По приоритету" },
            { id: "due", title: "По сроку" },
            { id: "status", title: "По статусу" },
            { id: "title", title: "По названию" }
        ]),
        h("button", {
            class: "btn btn--ghost btn--small",
            type: "button",
            text: "Сбросить фильтры",
            on: { click: clearFilters }
        })
    ]);
}

function filterSelect(label, key, options) {
    var select = h("select", {
        "aria-label": label,
        on: {
            change: function () {
                state[key] = select.value;
                renderAll();
            }
        }
    }, options.map(function (option) {
        return h("option", { value: option.id, text: option.title });
    }));
    select.value = state[key];
    return select;
}

function clearFilters() {
    state.project = "all";
    state.priority = "all";
    state.status = "all";
    state.sort = "priority";
    state.search = "";
    if ($("searchInput")) {
        $("searchInput").value = "";
    }
    renderAll();
}

function renderBoard() {
    var tasks = visibleTasks();
    var stats = computeStats(tasks);

    var columns = STATUSES.map(function (status) {
        var items = tasks.filter(function (task) {
            return task.status === status.id;
        });
        var body = h("div", { class: "column_body" }, items.length ? items.map(taskCard) : [
            h("p", { class: "column_empty", text: "Пусто" })
        ]);

        var column = h("section", {
            class: "column",
            data: { status: status.id }
        }, [
            h("div", { class: "column_head" }, [
                h("span", { class: "column_title", text: status.title }),
                h("span", { class: "column_count", text: String(items.length) })
            ]),
            body
        ]);

        column.addEventListener("dragover", function (event) {
            event.preventDefault();
            column.classList.add("is-drop");
        });
        column.addEventListener("dragleave", function () {
            column.classList.remove("is-drop");
        });
        column.addEventListener("drop", function (event) {
            event.preventDefault();
            column.classList.remove("is-drop");
            var id = event.dataTransfer.getData("text/plain");
            if (!id) {
                return;
            }
            var result = moveTask(id, status.id);
            if (result.ok) {
                showToast("success", "Статус обновлён", "Задача перешла в «" + status.title + "».");
            }
            renderAll();
        });

        return column;
    });

    return h("div", { class: "view" }, [
        pageHead(
            "Доска задач",
            "Перетащите карточку в другую колонку, чтобы сменить статус",
            h("button", {
                class: "btn btn--primary",
                type: "button",
                text: "Новая задача",
                on: {
                    click: function () {
                        openTaskForm(null);
                    }
                }
            })
        ),
        renderToolbar(),
        h("p", {
            class: "note",
            style: "margin-bottom:16px",
            text: "Заблокировано задач: " + stats.blocked +
                ". Их нельзя перевести в работу, пока не закрыты зависимости."
        }),
        h("div", { class: "board" }, columns)
    ]);
}

function renderStats() {
    var tasks = visibleTasks();
    var stats = computeStats(tasks);

    var metrics = h("div", { class: "grid-cards" }, [
        metricCard(stats.progress + "%", "Прогресс выполнения", "stat-card--ok"),
        metricCard(stats.done + " / " + stats.total, "Завершено задач"),
        metricCard(stats.hoursDone + " / " + stats.hoursTotal, "Часы (факт / план)"),
        metricCard(stats.overdue, "Просрочено", stats.overdue ? "stat-card--alert" : ""),
        metricCard(stats.blocked, "Заблокировано", stats.blocked ? "stat-card--alert" : ""),
        metricCard(stats.dueSoon, "Срок в ближайшие 2 дня", stats.dueSoon ? "stat-card--alert" : "")
    ]);

    var donut = h("div", { class: "donut" }, [
        h("div", { class: "donut_chart", style: "background:" + donutGradient(stats) }, [
            h("div", { class: "donut_center" }, [
                h("span", { class: "donut_value", text: stats.progress + "%" }),
                h("span", { class: "donut_label", text: "готово" })
            ])
        ]),
        h("div", { class: "legend" }, STATUSES.map(function (status) {
            var count = stats.byStatus[status.id] || 0;
            var percent = stats.total ? Math.round((count / stats.total) * 100) : 0;
            return h("div", { class: "legend_item" }, [
                h("span", {
                    class: "legend_dot",
                    style: "background:" + statusColor(status.id)
                }),
                h("span", { text: status.title + " · " + percent + "%" }),
                h("span", { class: "legend_count", text: String(count) })
            ]);
        }))
    ]);

    var priorityBars = h("div", { class: "bars" }, PRIORITIES.slice().reverse().map(function (priority) {
        return barRow(priority.title, stats.byPriority[priority.id] || 0, stats.total, priorityColor(priority.id));
    }));

    var projectBars = h("div", { class: "bars" }, state.projects.map(function (project) {
        var data = stats.byProject[project.id] || { total: 0, done: 0 };
        return barRow(project.name, data.done, data.total || 1, project.color);
    }));

    var insights = h("div", { class: "list-block" }, [
        insightRow("Проектов в работе", String(state.projects.length)),
        insightRow("Задач без срока", String(tasks.filter(function (task) {
            return !task.dueDate;
        }).length)),
        insightRow("Зависимостей между задачами", String(tasks.reduce(function (sum, task) {
            return sum + (task.dependsOn || []).length;
        }, 0))),
        insightRow("Средняя оценка задачи", averageEstimate(tasks) + " ч"),
        insightRow("Самый нагруженный проект", busiestProject(stats))
    ]);

    return h("div", { class: "view" }, [
        pageHead("Статистика проекта", "Выполнение, риски и загрузка по задачам"),
        metrics,
        h("div", { class: "two-col", style: "margin-bottom:16px" }, [
            h("div", { class: "card" }, [
                h("p", { class: "card_title", text: "Распределение по статусам" }),
                donut
            ]),
            h("div", { class: "card" }, [
                h("p", { class: "card_title", text: "Задачи по приоритету" }),
                priorityBars
            ])
        ]),
        h("div", { class: "two-col" }, [
            h("div", { class: "card" }, [
                h("p", { class: "card_title", text: "Выполнено задач по проектам" }),
                projectBars
            ]),
            h("div", { class: "card" }, [
                h("p", { class: "card_title", text: "Показатели работы" }),
                insights
            ])
        ])
    ]);
}

function insightRow(label, value) {
    return h("div", { class: "list-row" }, [
        h("span", { class: "muted", text: label }),
        h("span", { class: "list-row_side" }, [
            h("b", { text: value })
        ])
    ]);
}

function averageEstimate(tasks) {
    if (!tasks.length) {
        return 0;
    }
    var total = tasks.reduce(function (sum, task) {
        return sum + (Number(task.estimate) || 0);
    }, 0);
    return Math.round(total / tasks.length);
}

function busiestProject(stats) {
    var best = null;
    state.projects.forEach(function (project) {
        var data = stats.byProject[project.id];
        if (!data) {
            return;
        }
        if (!best || data.total > best.total) {
            best = { name: project.name, total: data.total };
        }
    });
    return best ? best.name + " (" + best.total + ")" : "—";
}

function donutGradient(stats) {
    if (!stats.total) {
        return "conic-gradient(#f0e2e4 0% 100%)";
    }
    var parts = [];
    var acc = 0;
    STATUSES.forEach(function (status) {
        var count = stats.byStatus[status.id] || 0;
        if (!count) {
            return;
        }
        var start = (acc / stats.total) * 100;
        acc += count;
        var end = (acc / stats.total) * 100;
        parts.push(statusColor(status.id) + " " + start + "% " + end + "%");
    });
    return "conic-gradient(" + parts.join(", ") + ")";
}

function renderView() {
    var root = $("viewRoot");
    if (!root) {
        return;
    }
    clear(root);

    var node;
    try {
        if (state.view === "board") {
            node = renderBoard();
        } else if (state.view === "list") {
            node = renderList();
        } else if (state.view === "stats") {
            node = renderStats();
        } else {
            node = renderOverview();
        }
    } catch (error) {
        node = h("div", { class: "view" }, [
            h("p", { class: "empty", text: "Не удалось отобразить экран: " + error.message })
        ]);
    }

    root.appendChild(node);
}

function renderAll() {
    renderSidebar();
    renderUser();
    renderView();
}
