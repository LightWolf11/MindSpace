"use strict";

var STORAGE_KEY = "mindspace-data";
var DEMO_EMAIL = "demo@mindspace.app";
var DEMO_PASSWORD = "mindspace";

var STATUSES = [
    { id: "backlog", title: "Бэклог" },
    { id: "todo", title: "К работе" },
    { id: "progress", title: "В работе" },
    { id: "review", title: "Проверка" },
    { id: "done", title: "Готово" }
];

var PRIORITIES = [
    { id: "low", title: "Низкий", weight: 1 },
    { id: "medium", title: "Средний", weight: 2 },
    { id: "high", title: "Высокий", weight: 3 },
    { id: "critical", title: "Критический", weight: 4 }
];

var STARTED_STATUSES = ["progress", "review", "done"];
var HIGH_PRIORITIES = ["high", "critical"];

var state = {
    user: null,
    view: "overview",
    project: "all",
    search: "",
    priority: "all",
    status: "all",
    sort: "priority",
    projects: [],
    tasks: []
};

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

function statusById(id) {
    for (var i = 0; i < STATUSES.length; i += 1) {
        if (STATUSES[i].id === id) {
            return STATUSES[i];
        }
    }
    return STATUSES[0];
}

function priorityById(id) {
    for (var i = 0; i < PRIORITIES.length; i += 1) {
        if (PRIORITIES[i].id === id) {
            return PRIORITIES[i];
        }
    }
    return PRIORITIES[0];
}

function priorityWeight(id) {
    return priorityById(id).weight;
}

function projectById(id) {
    for (var i = 0; i < state.projects.length; i += 1) {
        if (state.projects[i].id === id) {
            return state.projects[i];
        }
    }
    return { id: "", name: "Без проекта", color: "#d2a79e" };
}

function taskById(id) {
    for (var i = 0; i < state.tasks.length; i += 1) {
        if (state.tasks[i].id === id) {
            return state.tasks[i];
        }
    }
    return null;
}

function today() {
    var date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
}

function toISO(date) {
    var month = String(date.getMonth() + 1);
    var day = String(date.getDate());
    if (month.length < 2) {
        month = "0" + month;
    }
    if (day.length < 2) {
        day = "0" + day;
    }
    return date.getFullYear() + "-" + month + "-" + day;
}

function shiftDays(days) {
    var date = today();
    date.setDate(date.getDate() + days);
    return toISO(date);
}

function parseISO(value) {
    var parts = String(value).split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function formatDate(value) {
    if (!value) {
        return "без срока";
    }
    var months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    var date = parseISO(value);
    return date.getDate() + " " + months[date.getMonth()] + " " + date.getFullYear();
}

function daysLeft(value) {
    if (!value) {
        return null;
    }
    var diff = parseISO(value).getTime() - today().getTime();
    return Math.round(diff / 86400000);
}

function isOverdue(task) {
    if (!task.dueDate || task.status === "done") {
        return false;
    }
    return daysLeft(task.dueDate) < 0;
}

function isDueSoon(task) {
    var left = daysLeft(task.dueDate);
    if (left === null || task.status === "done") {
        return false;
    }
    return left >= 0 && left <= 2;
}

function dueLabel(task) {
    var left = daysLeft(task.dueDate);
    if (!task.dueDate) {
        return "без срока";
    }
    if (left === null) {
        return formatDate(task.dueDate);
    }
    return formatDate(task.dueDate);
}

function dueHint(task) {
    var left = daysLeft(task.dueDate);
    if (left === null || task.status === "done") {
        return "";
    }
    if (left < 0) {
        return "просрочено на " + Math.abs(left) + " дн.";
    }
    if (left === 0) {
        return "срок сегодня";
    }
    if (left === 1) {
        return "остался 1 день";
    }
    return "осталось " + left + " дн.";
}

function isHighPriority(task) {
    return HIGH_PRIORITIES.indexOf(task.priority) !== -1;
}

function dependenciesOf(task) {
    var list = [];
    (task.dependsOn || []).forEach(function (id) {
        var dep = taskById(id);
        if (dep) {
            list.push(dep);
        }
    });
    return list;
}

function unmetDependencies(task) {
    return dependenciesOf(task).filter(function (dep) {
        return dep.status !== "done";
    });
}

function isBlocked(task) {
    if (task.status === "done") {
        return false;
    }
    return unmetDependencies(task).length > 0;
}

function dependentsOf(taskId) {
    return state.tasks.filter(function (task) {
        return (task.dependsOn || []).indexOf(taskId) !== -1;
    });
}

function createsCycle(taskId, depId) {
    if (taskId === depId) {
        return true;
    }
    var stack = [depId];
    var seen = {};
    while (stack.length) {
        var current = stack.pop();
        if (current === taskId) {
            return true;
        }
        if (seen[current]) {
            continue;
        }
        seen[current] = true;
        var task = taskById(current);
        if (!task) {
            continue;
        }
        (task.dependsOn || []).forEach(function (next) {
            stack.push(next);
        });
    }
    return false;
}

function canMoveTo(task, statusId) {
    if (STARTED_STATUSES.indexOf(statusId) === -1) {
        return { allowed: true };
    }
    var blockers = unmetDependencies(task);
    if (blockers.length) {
        return {
            allowed: false,
            blockers: blockers,
            message: "Сначала завершите: " + blockers.map(function (item) {
                return "«" + item.title + "»";
            }).join(", ")
        };
    }
    return { allowed: true };
}

function validateTask(values, currentId) {
    var errors = {};
    var title = String(values.title || "").trim();

    if (!title) {
        errors.title = "Укажите название задачи";
    } else if (title.length < 3) {
        errors.title = "Название слишком короткое";
    } else if (title.length > 90) {
        errors.title = "Не больше 90 символов";
    }

    if (!projectById(values.projectId).id) {
        errors.projectId = "Выберите проект";
    }

    if (values.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(values.dueDate)) {
        errors.dueDate = "Некорректная дата";
    }

    var estimate = Number(values.estimate);
    if (values.estimate !== "" && (isNaN(estimate) || estimate < 0 || estimate > 200)) {
        errors.estimate = "Оценка от 0 до 200 часов";
    }

    (values.dependsOn || []).forEach(function (depId) {
        if (depId === currentId) {
            errors.dependsOn = "Задача не может зависеть от себя";
        } else if (createsCycle(currentId, depId)) {
            errors.dependsOn = "Такая связь создаст замкнутый круг зависимостей";
        }
    });

    return errors;
}

function validateLogin(values) {
    var errors = {};
    if (!values.email) {
        errors.email = "Введите электронную почту";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) {
        errors.email = "Похоже, в адресе опечатка";
    }
    if (!values.password) {
        errors.password = "Введите пароль";
    } else if (values.password.length < 6) {
        errors.password = "Минимум 6 символов";
    }
    return errors;
}

function validateRegister(values) {
    var errors = validateLogin(values);
    if (!values.name) {
        errors.name = "Введите имя";
    } else if (values.name.trim().split(" ").length < 2) {
        errors.name = "Укажите имя и фамилию";
    }
    if (values.password2 !== values.password) {
        errors.password2 = "Пароли не совпадают";
    }
    return errors;
}

function computeStats(tasks) {
    var stats = {
        total: tasks.length,
        done: 0,
        active: 0,
        overdue: 0,
        blocked: 0,
        highPriority: 0,
        dueSoon: 0,
        hoursTotal: 0,
        hoursDone: 0,
        byStatus: {},
        byPriority: {},
        byProject: {}
    };

    STATUSES.forEach(function (status) {
        stats.byStatus[status.id] = 0;
    });
    PRIORITIES.forEach(function (priority) {
        stats.byPriority[priority.id] = 0;
    });
    state.projects.forEach(function (project) {
        stats.byProject[project.id] = { total: 0, done: 0 };
    });

    tasks.forEach(function (task) {
        stats.byStatus[task.status] = (stats.byStatus[task.status] || 0) + 1;
        stats.byPriority[task.priority] = (stats.byPriority[task.priority] || 0) + 1;
        if (!stats.byProject[task.projectId]) {
            stats.byProject[task.projectId] = { total: 0, done: 0 };
        }
        stats.byProject[task.projectId].total += 1;
        stats.hoursTotal += Number(task.estimate) || 0;

        if (task.status === "done") {
            stats.done += 1;
            stats.hoursDone += Number(task.estimate) || 0;
            stats.byProject[task.projectId].done += 1;
        } else {
            stats.active += 1;
        }
        if (isOverdue(task)) {
            stats.overdue += 1;
        }
        if (isBlocked(task)) {
            stats.blocked += 1;
        }
        if (isHighPriority(task) && task.status !== "done") {
            stats.highPriority += 1;
        }
        if (isDueSoon(task)) {
            stats.dueSoon += 1;
        }
    });

    stats.progress = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
    return stats;
}

function visibleTasks() {
    var query = state.search.trim().toLowerCase();
    var list = state.tasks.filter(function (task) {
        if (state.project !== "all" && task.projectId !== state.project) {
            return false;
        }
        if (state.priority !== "all" && task.priority !== state.priority) {
            return false;
        }
        if (state.status !== "all" && task.status !== state.status) {
            return false;
        }
        if (!query) {
            return true;
        }
        var haystack = [task.title, task.description, projectById(task.projectId).name]
            .concat(task.tags || [])
            .join(" ")
            .toLowerCase();
        return haystack.indexOf(query) !== -1;
    });

    list.sort(function (a, b) {
        if (state.sort === "due") {
            var left = a.dueDate || "9999-12-31";
            var right = b.dueDate || "9999-12-31";
            return left < right ? -1 : left > right ? 1 : 0;
        }
        if (state.sort === "title") {
            return a.title.localeCompare(b.title, "ru");
        }
        if (state.sort === "status") {
            return STATUSES.map(function (item) {
                return item.id;
            }).indexOf(a.status) - STATUSES.map(function (item) {
                return item.id;
            }).indexOf(b.status);
        }
        return priorityWeight(b.priority) - priorityWeight(a.priority);
    });

    return list;
}
function makeTask(id, title, projectId, priority, status, dueOffset, estimate, dependsOn, description, tags) {
    return {
        id: id,
        title: title,
        description: description || "",
        projectId: projectId,
        priority: priority,
        status: status,
        dueDate: dueOffset === null ? "" : shiftDays(dueOffset),
        estimate: estimate,
        dependsOn: dependsOn || [],
        tags: tags || [],
        createdAt: shiftDays(-14),
        updatedAt: shiftDays(-1)
    };
}

function demoProjects() {
    return [
        { id: "p1", name: "Мобильное приложение", color: "#5c1f2d" },
        { id: "p2", name: "Дизайн-система", color: "#c98b7f" },
        { id: "p3", name: "Запуск и маркетинг", color: "#b0904a" }
    ];
}

function demoTasks() {
    return [
        makeTask("t1", "Определить цели спринта", "p1", "high", "done", -12, 4, [],
            "Сформулировать три измеримые цели на две недели.", ["планирование"]),
        makeTask("t2", "Собрать требования с заказчиком", "p1", "critical", "done", -8, 8, ["t1"],
            "Интервью, список сценариев и ограничения по срокам.", ["аналитика"]),
        makeTask("t3", "Спроектировать схему данных", "p1", "high", "progress", 1, 12, ["t2"],
            "Описать сущности задач, проектов и зависимостей.", ["архитектура"]),
        makeTask("t4", "Собрать макет главного экрана", "p1", "medium", "review", -2, 6, ["t2"],
            "Макет списка задач с фильтрами и статусами.", ["дизайн"]),
        makeTask("t5", "Реализовать экран задач", "p1", "critical", "todo", 3, 16, ["t3"],
            "Список, карточка задачи и переключение статусов.", ["frontend"]),
        makeTask("t6", "Подключить хранилище задач", "p1", "high", "backlog", 6, 14, ["t5"],
            "Сохранять задачи и зависимости между сессиями.", ["frontend"]),
        makeTask("t7", "Настроить цветовые токены", "p2", "medium", "done", -10, 5, [],
            "Палитра проекта: основной и акцентный цвет.", ["дизайн"]),
        makeTask("t8", "Описать компоненты кнопок и полей", "p2", "high", "progress", 2, 10, ["t7"],
            "Состояния: обычное, наведение, фокус, ошибка.", ["компоненты"]),
        makeTask("t9", "Собрать гайд по типографике", "p2", "low", "todo", 9, 6, ["t7"],
            "Размеры заголовков, текста и подписей.", ["документация"]),
        makeTask("t10", "Проверить контрастность интерфейса", "p2", "medium", "todo", -1, 4, ["t8"],
            "Проверка читаемости текста и состояний элементов.", ["доступность"]),
        makeTask("t11", "Подготовить лендинг продукта", "p3", "high", "progress", 4, 12, [],
            "Первый экран, возможности и призыв к действию.", ["маркетинг"]),
        makeTask("t12", "Написать текст для рассылки", "p3", "low", "backlog", 7, 3, ["t11"],
            "Письмо о запуске для тестовой группы.", ["контент"]),
        makeTask("t13", "Запланировать демо для команды", "p3", "critical", "todo", 1, 2, ["t6", "t11"],
            "Собрать сценарий показа и список вопросов.", ["коммуникация"]),
        makeTask("t14", "Собрать метрики после демо", "p3", "medium", "backlog", 12, 5, ["t13"],
            "Обратная связь команды и план следующего спринта.", ["аналитика"])
    ];
}

function resetDemoData() {
    state.projects = demoProjects();
    state.tasks = demoTasks();
    saveState();
}

function loadState() {
    var raw = null;
    try {
        raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
        raw = null;
    }

    if (!raw) {
        state.projects = demoProjects();
        state.tasks = demoTasks();
        return;
    }

    try {
        var data = JSON.parse(raw);
        state.user = data.user || null;
        state.projects = data.projects && data.projects.length ? data.projects : demoProjects();
        state.tasks = data.tasks && data.tasks.length ? data.tasks : demoTasks();
    } catch (error) {
        state.projects = demoProjects();
        state.tasks = demoTasks();
        showToast("error", "Данные повреждены", "Загружены демонстрационные задачи заново.");
    }
}

function saveState() {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            user: state.user,
            projects: state.projects,
            tasks: state.tasks
        }));
    } catch (error) {
        showToast("error", "Не удалось сохранить", "Браузер запретил запись в локальное хранилище.");
    }
}

function nextTaskId() {
    var max = 0;
    state.tasks.forEach(function (task) {
        var number = Number(String(task.id).replace(/\D/g, ""));
        if (number > max) {
            max = number;
        }
    });
    return "t" + (max + 1);
}

function nextProjectId() {
    var max = 0;
    state.projects.forEach(function (project) {
        var number = Number(String(project.id).replace(/\D/g, ""));
        if (number > max) {
            max = number;
        }
    });
    return "p" + (max + 1);
}

function createTask(values) {
    var task = {
        id: nextTaskId(),
        title: values.title.trim(),
        description: values.description.trim(),
        projectId: values.projectId,
        priority: values.priority,
        status: values.status,
        dueDate: values.dueDate || "",
        estimate: Number(values.estimate) || 0,
        dependsOn: values.dependsOn.slice(),
        tags: values.tags.slice(),
        createdAt: toISO(today()),
        updatedAt: toISO(today())
    };
    state.tasks.push(task);
    saveState();
    return task;
}

function updateTask(id, values) {
    var task = taskById(id);
    if (!task) {
        return null;
    }
    task.title = values.title.trim();
    task.description = values.description.trim();
    task.projectId = values.projectId;
    task.priority = values.priority;
    task.status = values.status;
    task.dueDate = values.dueDate || "";
    task.estimate = Number(values.estimate) || 0;
    task.dependsOn = values.dependsOn.slice();
    task.tags = values.tags.slice();
    task.updatedAt = toISO(today());
    saveState();
    return task;
}

function removeTask(id) {
    var task = taskById(id);
    if (!task) {
        return false;
    }
    state.tasks = state.tasks.filter(function (item) {
        return item.id !== id;
    });
    state.tasks.forEach(function (item) {
        item.dependsOn = (item.dependsOn || []).filter(function (depId) {
            return depId !== id;
        });
    });
    saveState();
    return true;
}

function moveTask(id, statusId) {
    var task = taskById(id);
    if (!task) {
        return { ok: false, message: "Задача не найдена" };
    }
    if (task.status === statusId) {
        return { ok: true, message: "" };
    }

    var check = canMoveTo(task, statusId);
    if (!check.allowed) {
        showToast("warning", "Задача заблокирована", check.message);
        return { ok: false, message: check.message };
    }

    var wasBlocking = task.status;
    task.status = statusId;
    task.updatedAt = toISO(today());
    saveState();

    if (statusId === "done") {
        var unlocked = dependentsOf(task.id).filter(function (item) {
            return item.status !== "done" && unmetDependencies(item).length === 0;
        });
        if (unlocked.length) {
            showToast("success", "Зависимости разблокированы", unlocked.map(function (item) {
                return "«" + item.title + "»";
            }).join(", ") + " — можно начинать.");
        }
    } else if (wasBlocking === "done") {
        var blocked = dependentsOf(task.id).filter(function (item) {
            return item.status === "progress" || item.status === "review";
        });
        if (blocked.length) {
            showToast("warning", "Задача снова активна", "Зависимые задачи считаются незавершёнными: " +
                blocked.map(function (item) {
                    return "«" + item.title + "»";
                }).join(", "));
        }
    }

    return { ok: true, message: "" };
}

function createProject(name, color) {
    var project = {
        id: nextProjectId(),
        name: name.trim(),
        color: color
    };
    state.projects.push(project);
    saveState();
    return project;
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
    var foot = [
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
    ];
    openModal(title, h("p", { text: text }), foot);
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

function dueHintNode(task) {
    var hint = dueHint(task);
    if (!hint) {
        return null;
    }
    return h("span", {
        class: isOverdue(task) ? "table_title is-overdue-text" : "muted",
        text: hint
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
        return h("option", {
            value: status.id,
            text: status.title,
            selected: status.id === task.status ? "selected" : null
        });
    }));
    select.value = task.status;
    return select;
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

    var meta = [
        priorityBadge(task),
        dueBadge(task)
    ];
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
        h("div", { class: "task_top" }, [
            h("p", {
                class: "task_title",
                text: task.title,
                on: {
                    click: function () {
                        openTaskDetails(task.id);
                    }
                }
            })
        ]),
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
            h("div", {
                class: "bar_fill",
                style: "width:" + percent + "%;background:" + color
            })
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

function renderProjects() {
    var container = $("projectList");
    if (!container) {
        return;
    }
    clear(container);

    var allButton = h("button", {
        class: "project" + (state.project === "all" ? " is-active" : ""),
        type: "button",
        on: {
            click: function () {
                state.project = "all";
                renderAll();
            }
        }
    }, [
        h("span", { class: "project_dot", style: "background:#5c1f2d" }),
        h("span", { class: "truncate", text: "Все задачи" }),
        h("span", { class: "project_count", text: String(state.tasks.length) })
    ]);
    container.appendChild(allButton);

    state.projects.forEach(function (project) {
        var count = state.tasks.filter(function (task) {
            return task.projectId === project.id;
        }).length;
        container.appendChild(h("button", {
            class: "project" + (state.project === project.id ? " is-active" : ""),
            type: "button",
            on: {
                click: function () {
                    state.project = project.id;
                    renderAll();
                }
            }
        }, [
            h("span", { class: "project_dot", style: "background:" + project.color }),
            h("span", { class: "truncate", text: project.name }),
            h("span", { class: "project_count", text: String(count) })
        ]));
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
        h("span", { class: "truncate", text: "+ Новый проект" })
    ]));
}

function renderHeaderUser() {
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
        return isBlocked(task) && task.status !== "done";
    });
    var soon = tasks.filter(isDueSoon).sort(function (a, b) {
        return (a.dueDate || "").localeCompare(b.dueDate || "");
    });
    var important = tasks.filter(function (task) {
        return isHighPriority(task) && task.status !== "done";
    }).sort(function (a, b) {
        return priorityWeight(b.priority) - priorityWeight(a.priority);
    });

    var attention = overdue.concat(blocked.filter(function (task) {
        return overdue.indexOf(task) === -1;
    }));

    var head = pageHead(
        "Обзор проекта",
        state.project === "all" ? "Сводка по всем проектам рабочего пространства" : "Проект: " + projectById(state.project).name,
        h("button", {
            class: "btn btn--primary",
            type: "button",
            text: "Новая задача",
            on: { click: function () { openTaskForm(null); } }
        })
    );

    var metrics = h("div", { class: "grid-cards" }, [
        metricCard(stats.total, "Всего задач"),
        metricCard(stats.progress + "%", "Выполнено", "stat-card--ok"),
        metricCard(stats.active, "В работе и планах"),
        metricCard(stats.overdue, "Просрочено", stats.overdue ? "stat-card--alert" : ""),
        metricCard(stats.blocked, "Заблокировано зависимостями", stats.blocked ? "stat-card--alert" : ""),
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
                h("span", {
                    text: stats.hoursTotal ? Math.round((stats.hoursDone / stats.hoursTotal) * 100) + "%" : "0%"
                })
            ]),
            progressBar(stats.hoursTotal ? Math.round((stats.hoursDone / stats.hoursTotal) * 100) : 0)
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

    var projectProgress = h("div", { class: "card" }, [
        h("p", { class: "card_title", text: "Прогресс по проектам" }),
        h("div", { class: "bars" }, state.projects.map(function (project) {
            var data = stats.byProject[project.id] || { total: 0, done: 0 };
            var percent = data.total ? Math.round((data.done / data.total) * 100) : 0;
            return h("div", { class: "bar-row" }, [
                h("span", { text: project.name }),
                h("div", { class: "bar" }, [
                    h("div", { class: "bar_fill", style: "width:" + percent + "%;background:" + project.color })
                ]),
                h("span", { class: "bar_value", text: percent + "%" })
            ]);
        }))
    ]);

    return h("div", { class: "view" }, [
        head,
        metrics,
        h("div", { class: "two-col", style: "margin-bottom:16px" }, [progressCard, attentionCard]),
        h("div", { class: "two-col" }, [soonCard, importantCard]),
        h("div", { style: "margin-top:16px" }, [projectProgress])
    ]);
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

    var toolbar = h("div", { class: "toolbar" }, [
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
            text: "Сбросить",
            on: {
                click: function () {
                    clearFilters();
                }
            }
        })
    ]);

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
        pageHead("Список задач", "Найдено задач: " + tasks.length +
            (state.search ? " · поиск: «" + state.search + "»" : "")),
        toolbar,
        rows.length ? table : emptyState("Под выбранные условия задачи не найдены.")
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
