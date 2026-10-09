"use strict";

var STORAGE_KEY = "mindspace-data";
var CURRENT_USER_KEY = "mindspace-current-user";
var DEMO_EMAIL = "vladislav@mindspace.app";
var DEMO_PASSWORD = "mindspace";

function normalizeUserEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function userStorageKey(email) {
    var safe = normalizeUserEmail(email).replace(/[^a-z0-9._@-]/g, "-");
    return "mindspace-user-" + (safe || "guest");
}

function demoUser() {
    return {
        id: "user-demo",
        name: "Владислав Алексеевич",
        email: DEMO_EMAIL,
        role: "Организатор",
        initials: "АМ"
    };
}

function ensureDemoAccount() {
    try {
        var raw = window.localStorage.getItem(userStorageKey(DEMO_EMAIL));
        if (!raw) {
            window.localStorage.setItem(userStorageKey(DEMO_EMAIL), JSON.stringify({
                user: demoUser(),
                projects: demoProjects(),
                tasks: demoTasks()
            }));
        }
    } catch (error) {
        return;
    }
}

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
    filtersOpen: false,
    priority: "all",
    status: "all",
    sort: "priority",
    sortDirection: "desc",
    statusChangedTaskId: null,
    projects: [],
    tasks: [],
    invitations: []
};

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
    } else if (values.password.length < 8) {
        errors.password = "Минимум 8 символов";
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
        var comparison = 0;
        if (state.sort === "due") {
            if (!a.dueDate || !b.dueDate) {
                comparison = !a.dueDate && !b.dueDate ? 0 : (!a.dueDate ? 1 : -1);
            } else {
                comparison = a.dueDate.localeCompare(b.dueDate);
            }
        } else if (state.sort === "title") {
            comparison = a.title.localeCompare(b.title, "ru");
        } else if (state.sort === "project") {
            comparison = projectById(a.projectId).name.localeCompare(projectById(b.projectId).name, "ru");
        } else if (state.sort === "status") {
            var order = STATUSES.map(function (item) {
                return item.id;
            });
            comparison = order.indexOf(a.status) - order.indexOf(b.status);
        } else if (state.sort === "estimate") {
            comparison = (Number(a.estimate) || 0) - (Number(b.estimate) || 0);
        } else {
            comparison = priorityWeight(a.priority) - priorityWeight(b.priority);
        }
        return state.sortDirection === "desc" ? -comparison : comparison;
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

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        demoUser: demoUser,
        demoProjects: demoProjects,
        demoTasks: demoTasks,
        demoPassword: DEMO_PASSWORD
    };
}

function resetDemoData() {
    if (!state.user) {
        state.projects = demoProjects();
        state.tasks = demoTasks();
        return;
    }

    var userKey = userStorageKey(state.user.email);
    try {
        window.localStorage.setItem(userKey, JSON.stringify({
            user: state.user,
            projects: demoProjects(),
            tasks: demoTasks()
        }));
    } catch (error) {
        showToast("error", "Не удалось сбросить", "Браузер запретил изменение хранилища.");
        return;
    }

    state.projects = demoProjects();
    state.tasks = demoTasks();
    saveState();
}

function getCurrentStorageData() {
    var user = state.user || null;
    if (!user || !user.email) {
        return null;
    }
    var raw = null;
    try {
        raw = window.localStorage.getItem(userStorageKey(user.email));
    } catch (error) {
        return null;
    }

    if (!raw) {
        return { user: user, projects: demoProjects(), tasks: demoTasks() };
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        return { user: user, projects: demoProjects(), tasks: demoTasks() };
    }
}

function loadState() {
    ensureDemoAccount();

    var currentUser = null;
    try {
        var userData = window.localStorage.getItem(CURRENT_USER_KEY);
        if (userData) {
            currentUser = JSON.parse(userData);
        }
    } catch (error) {
        currentUser = null;
    }

    if (!currentUser || !currentUser.email) {
        state.user = null;
        state.projects = demoProjects();
        state.tasks = demoTasks();
        return;
    }

    state.user = currentUser;

    var data = getCurrentStorageData();
    if (!data) {
        state.projects = demoProjects();
        state.tasks = demoTasks();
        return;
    }

    state.user = data.user || currentUser;
    state.projects = data.projects && data.projects.length ? data.projects : demoProjects();
    state.tasks = data.tasks && data.tasks.length ? data.tasks : demoTasks();
}

function saveState() {
    try {
        if (state.user && state.user.email) {
            window.localStorage.setItem(userStorageKey(state.user.email), JSON.stringify({
                user: state.user,
                projects: state.projects,
                tasks: state.tasks
            }));
        }
        if (state.user && state.user.email) {
            window.localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(state.user));
        } else {
            window.localStorage.removeItem(CURRENT_USER_KEY);
        }
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

    var previousStatus = task.status;
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
    } else if (previousStatus === "done") {
        var affected = dependentsOf(task.id).filter(function (item) {
            return item.status === "progress" || item.status === "review";
        });
        if (affected.length) {
            showToast("warning", "Задача снова активна", "У зависимых задач появился незавершённый блокер: " +
                affected.map(function (item) {
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
