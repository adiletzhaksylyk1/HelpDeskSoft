// Multi-Language Support
let currentLang = localStorage.getItem('hd_lang') || 'RU';

const I18N = {
  RU: {
    // Navigation & Queues
    views: 'Очереди',
    all_tickets: 'Все заявки',
    my_assigned: 'Мои заявки',
    unassigned_queue: 'Нераспределенные',
    admin_section: 'Администрирование',
    staff_roles: 'Сотрудники и роли',
    roles_departments: 'Роли и отделы',
    mailboxes_inboxes: 'Почтовые ящики',
    channels_title: 'Каналы связи',
    all_inboxes: 'Все ящики',

    // Statuses
    status_title: 'Статус',
    all_statuses: 'Все статусы',
    status_waiting: 'В ожидании',
    status_in_progress: 'В работе',
    status_resolved: 'Решена',

    // Priorities
    priority_title: 'Приоритет',
    all_priorities: 'Все приоритеты',
    priority_critical: 'Критический',
    priority_high: 'Высокий',
    priority_medium: 'Средний',
    priority_low: 'Низкий',

    // Header & Search
    tickets_heading: 'Заявки',
    search_placeholder: 'Поиск по теме, email или содержимому...',
    create_ticket: 'Создать заявку',
    online: 'В сети',
    login: 'Войти',
    logout: 'Выйти',
    staff_and_roles: 'Сотрудники и роли',
    mailboxes_and_channels: 'Почтовые ящики',
    refresh: 'Обновить',

    // Ticket View Details
    empty_title: 'Выберите заявку для просмотра',
    empty_desc: 'Выберите обращение из списка слева, чтобы ознакомиться с историей и ответить клиенту',
    breadcrumb_tickets: 'Управление заявками',
    flow_title: 'История обращения и переписка',
    attachments_title: 'Прикрепленные файлы',
    reply_from: 'Ответить от имени:',
    reply_placeholder: 'Напишите ответ клиенту...',
    reply_auth_locked: 'Требуется авторизация сотрудника для ответа...',
    reply_auth_notice: 'Войдите в аккаунт сотрудника, чтобы ответить на заявку',
    btn_attach: 'Прикрепить файлы',
    btn_download: 'Скачать',
    click_to_view: 'Нажмите для просмотра',
    expired: 'Истек',
    btn_send: 'Отправить ответ',
    btn_save: 'Сохранить',
    btn_resolve: 'Решить заявку',
    btn_delete: 'Удалить',
    btn_delete_ticket: 'Удалить заявку',
    delete: 'Удалить',

    // Meta labels
    meta_sender: 'Заявитель',
    meta_date: 'Дата создания',
    meta_status: 'Статус',
    meta_priority: 'Приоритет',
    meta_assignee: 'Ответственный',
    unassigned: '(Не назначен)',

    // Notifications
    notif_title: 'Уведомления',
    notif_mark_read: 'Прочитать все',
    notif_clear: 'Очистить все',
    notif_empty: 'Новых уведомлений нет',
    notif_new_ticket: 'Новое обращение',
    notif_urgent_ticket: 'Поступило срочное обращение',
    notif_ticket_updated: 'Заявка обновлена',
    notif_reply_sent: 'Ответ отправлен',
    notif_new_reply: 'Новый ответ клиента',
    notif_changes_saved_desc: 'Изменения сохранены',
    notif_reply_dispatched_desc: 'Ответ отправлен заявителю',
    notif_assigned_to_you: 'Заявка назначена вам',
    notif_no_subject: 'Без темы',
    notif_customer: 'клиент',


    // System Feedback
    changes_saved: 'Изменения успешно сохранены',
    no_pending_changes: 'Нет несохраненных изменений',
    saving: 'Сохранение...',
    auth_required_reply: 'Войдите в систему для ответа на обращение',
    back_to_list: 'Назад к списку',

    // Admin & Management
    tab_staff: 'Сотрудники',
    tab_roles: 'Роли и отделы',
    tab_mailboxes: 'Почтовые ящики',
    btn_add_role: '+ Создать роль / отдел',
    btn_create_role: 'Создать роль',
    create_role_title: 'Создание роли / отдела',
    role_name: 'Роль / Отдел',
    role_description: 'Описание',
    role_access: 'Уровень доступа',
    role_staff_count: 'Сотрудников',
    role_is_admin_label: 'Права администратора (доступ к панели управления и настройкам)',
    role_name_label: 'Название роли / отдела',
    role_desc_label: 'Описание обязанностей',
    access_admin: 'Администратор',
    access_staff: 'Cпециалист поддержки',
    role_admin: 'Администратор',
    role_employee: 'Специалист',

    cancel: 'Отмена',
    role_created: 'Роль успешно создана',
    role_deleted: 'Роль успешно удалена',
    btn_reset_pass: 'Сбросить пароль',
    btn_reset_pass_title: 'Сбросить пароль (потребует ввод нового при входе)',
    confirm_reset_pass: 'Сбросить пароль для сотрудника «{name}»?\nПри следующем входе в систему ему потребуется создать новый постоянный пароль.',
    reset_pass_success: 'Пароль успешно сброшен. Сотрудник задаст новый при следующем входе.',
    target_role_col: 'Отдел назначения',
    target_role_label: 'Направлять заявки в отдел / роль',
    target_role_hint: 'Автоматически распределять входящие обращения сотрудникам этой роли',
    all_departments_fallback: '(Общая очередь / Все отделы)',

    // Auth
    auth_welcome: 'Добро пожаловать в DU HelpDesk',
    auth_subtitle: 'Введите учетные данные для входа',
    auth_login_placeholder: 'Логин или email',
    auth_pass_placeholder: 'Пароль',
    auth_new_pass_placeholder: 'Придумайте новый пароль (мин. 8 символов)...',
    auth_first_login_title: 'Первый вход в систему!',
    auth_first_login_desc: 'Задайте надежный пароль (минимум 8 символов) для вашего аккаунта.',
    auth_first_login_btn: 'Установить пароль и войти',
    auth_email_required: 'Пожалуйста, введите логин или email',
    auth_pass_min_chars: 'Пароль должен содержать не менее 8 символов',
    auth_enter_password_hint: 'Введите пароль для входа в систему',
    login_checking: 'Проверка учетных данных...',
    welcome_toast: 'Успешный вход в систему!',

    // Modals & New Tickets
    modal_new_ticket_title: 'Создать обращение',
    modal_customer_email: 'Email заявителя',
    modal_subject: 'Тема обращения',
    modal_subject_placeholder: 'Краткая суть проблемы...',
    modal_priority: 'Приоритет',
    modal_description: 'Описание / Подробности проблемы',
    modal_description_placeholder: 'Подробное описание обращения...',
    modal_btn_create: 'Создать заявку',
    modal_admin_title: 'Панель администрирования',
    btn_add_staff: '+ Добавить сотрудника',
    btn_add_mailbox: '+ Подключить почту',
    col_name: 'ФИО сотрудника',
    col_email: 'Корпоративный Email',
    col_active_tickets: 'В работе',
    actions: 'Действия',
    close: 'Закрыть',
    modal_staff_title: 'Добавление сотрудника поддержки',
    modal_staff_role: 'Системная роль',
    modal_staff_hint: 'Новый сотрудник сможет задать личный пароль при первом входе в систему.',
    modal_staff_btn: 'Создать аккаунт',
    collision_assigned_warning: 'Внимание: Заявка закреплена за специалистом: ',
    collision_reply_alert: 'Внимание: Коллега только что отправил ответ на эту заявку! Проверьте новые сообщения ниже перед отправкой.',
    collision_confirm: 'Коллега уже ответил на эту заявку. Вы уверены, что хотите отправить еще один ответ клиенту?',
    auto_assigned_toast: 'Заявка автоматически закреплена за вами'
  },
  KZ: {
    // Navigation & Queues
    views: 'Кезектер',
    all_tickets: 'Барлық өтінімдер',
    my_assigned: 'Маған бекітілген',
    unassigned_queue: 'Бөлінбеген кезек',
    admin_section: 'Әкімшілендіру',
    staff_roles: 'Қызметкерлер мен рөлдер',
    roles_departments: 'Рөлдер мен бөлімдер',
    mailboxes_inboxes: 'Пошта жәшіктері',
    channels_title: 'Байланыс арналары',
    all_inboxes: 'Барлық жәшіктер',

    // Statuses
    status_title: 'Мәртебесі',
    all_statuses: 'Барлық мәртебелер',
    status_waiting: 'Күтуде',
    status_in_progress: 'Орындалуда',
    status_resolved: 'Шешілді',

    // Priorities
    priority_title: 'Маңыздылығы',
    all_priorities: 'Барлық маңыздылықтар',
    priority_critical: 'Шұғыл',
    priority_high: 'Жоғары',
    priority_medium: 'Орташа',
    priority_low: 'Төмен',

    // Header & Search
    tickets_heading: 'Өтінімдер',
    search_placeholder: 'Тақырыбы, email немесе мазмұны бойынша іздеу...',
    create_ticket: 'Өтінім құру',
    online: 'Желіде',
    login: 'Кіру',
    logout: 'Шығу',
    staff_and_roles: 'Қызметкерлер мен рөлдер',
    mailboxes_and_channels: 'Пошта жәшіктері',
    refresh: 'Жаңарту',

    // Ticket View Details
    empty_title: 'Қарау үшін өтінімді таңдаңыз',
    empty_desc: 'Тарихын қарап, өтініш берушіге жауап жазу үшін сол жақтағы тізімнен өтінімді таңдаңыз',
    breadcrumb_tickets: 'Өтінімдерді басқару',
    flow_title: 'Өтінім мәліметтері мен хат алмасу',
    attachments_title: 'Тіркелген файлдар',
    reply_from: 'Атынан жауап жіберу:',
    reply_placeholder: 'Өтініш берушіге жауап жазыңыз...',
    reply_auth_locked: 'Жауап жазу үшін қызметкер авторизациясы қажет...',
    reply_auth_notice: 'Өтінімге жауап беру үшін жүйеге қызметкер ретінде кіріңіз',
    btn_attach: 'Файлды тіркеу',
    btn_download: 'Жүктеу',
    click_to_view: 'Көру үшін басыңыз',
    expired: 'Мерзімі өтті',
    btn_send: 'Жауапты жіберу',
    btn_save: 'Сақтау',
    btn_resolve: 'Шешілді деп жабу',
    btn_delete: 'Жою',
    btn_delete_ticket: 'Өтінімді жою',
    delete: 'Жою',

    // Meta labels
    meta_sender: 'Өтініш беруші',
    meta_date: 'Құрылған күні',
    meta_status: 'Мәртебесі',
    meta_priority: 'Маңыздылығы',
    meta_assignee: 'Жауапты маман',
    unassigned: '(Бекітілмеген)',

    // Notifications
    notif_title: 'Хабарландырулар',
    notif_mark_read: 'Барлығын оқылды деп белгілеу',
    notif_clear: 'Барлығын өшіру',
    notif_empty: 'Жаңа хабарландыру жоқ',
    notif_new_ticket: 'Жаңа өтінім',
    notif_urgent_ticket: 'Шұғыл өтінім келіп түсті',
    notif_ticket_updated: 'Өтінім жаңартылды',
    notif_reply_sent: 'Жауап жіберілді',
    notif_new_reply: 'Клиенттен жаңа жауап',
    notif_changes_saved_desc: 'Өзгерістер сақталды',
    notif_reply_dispatched_desc: 'Өтініш берушіге жауап жіберілді',
    notif_assigned_to_you: 'Өтінім сізге тағайындалды',
    notif_no_subject: 'Тақырыпсыз',
    notif_customer: 'клиент',


    // System Feedback
    changes_saved: 'Өзгерістер сәтті сақталды',
    no_pending_changes: 'Сақталатын өзгерістер жоқ',
    saving: 'Сақталуда...',
    auth_required_reply: 'Өтінімге жауап беру үшін жүйеге қызметкер ретінде кіріңіз',
    back_to_list: 'Тізімге оралу',

    // Admin & Management
    tab_staff: 'Қызметкерлер тізімі',
    tab_roles: 'Рөлдер мен бөлімдер',
    tab_mailboxes: 'Пошта жәшіктері',
    btn_add_role: '+ Жаңа рөл / бөлім',
    btn_create_role: 'Рөлді құру',
    create_role_title: 'Жаңа рөл / бөлім құру',
    role_name: 'Рөл / Бөлім',
    role_description: 'Сипаттамасы',
    role_access: 'Қолжетімділік деңгейі',
    role_staff_count: 'Бекітілген мамандар',
    role_is_admin_label: 'Әкімші құқықтары (басқару панелі мен баптауларға толық қолжетімділік)',
    role_name_label: 'Рөл / бөлім атауы',
    role_desc_label: 'Міндеттер сипаттамасы',
    access_admin: 'Әкімші',
    access_staff: 'Қолдау маманы',
    role_admin: 'Әкімші',
    role_employee: 'Маман',

    cancel: 'Бас тарту',
    role_created: 'Рөл сәтті құрылды',
    role_deleted: 'Рөл сәтті жойылды',
    btn_reset_pass: 'Құпиясөзді қайтару',
    btn_reset_pass_title: 'Құпиясөзді қалпына келтіру (кіру кезінде жаңасын сұрайды)',
    confirm_reset_pass: '«{name}» қызметкерінің құпиясөзін қалпына келтіру керек пе?\nЖүйеге келесі рет кіргенде ол жаңа тұрақты құпиясөз орнатады.',
    reset_pass_success: 'Құпиясөз сәтті қалпына келтірілді. Келесі кіруде жаңа құпиясөз орнатылады.',
    target_role_col: 'Бағытталатын бөлім',
    target_role_label: 'Өтінімдерді осы рөлге / бөлімге бағыттау',
    target_role_hint: 'Кіріс хаттарды осы рөлдегі мамандарға автоматты түрде бөлу',
    all_departments_fallback: '(Жалпы кезек / Барлық бөлімдер)',

    // Auth
    auth_welcome: 'DU HelpDesk жүйесіне қош келдіңіз',
    auth_subtitle: 'Жүйеге кіру үшін логин мен құпия сөзді енгізіңіз',
    auth_login_placeholder: 'Логин немесе email',
    auth_pass_placeholder: 'Құпия сөз',
    auth_new_pass_placeholder: 'Жаңа құпия сөз ойлап табыңыз (кемінде 8 таңба)...',
    auth_first_login_title: 'Жүйеге алғаш рет кіру!',
    auth_first_login_desc: 'Есептік жазбаңызды қорғау үшін жаңа құпия сөз (кемінде 8 таңба) орнатыңыз.',
    auth_first_login_btn: 'Құпия сөзді орнатып, кіру',
    auth_email_required: 'Логин немесе email енгізіңіз',
    auth_pass_min_chars: 'Құпия сөз кемінде 8 таңбадан тұруы керек',
    auth_enter_password_hint: 'Жүйеге кіру үшін құпия сөзді енгізіңіз',
    login_checking: 'Тексерілуде...',
    welcome_toast: 'Жүйеге қош келдіңіз!',

    // Modals & New Tickets
    modal_new_ticket_title: 'Жаңа өтінім құру',
    modal_customer_email: 'Өтініш берушінің email-і',
    modal_subject: 'Өтінім тақырыбы',
    modal_subject_placeholder: 'Өтінімнің қысқаша мәні...',
    modal_priority: 'Маңыздылығы',
    modal_description: 'Мәселенің сипаттамасы',
    modal_description_placeholder: 'Мәселенің толық сипаттамасы...',
    modal_btn_create: 'Өтінімді құру',
    modal_admin_title: 'Жүйені басқару орталығы',
    btn_add_staff: '+ Маман қосу',
    btn_add_mailbox: '+ Пошта қосу',
    col_name: 'Маманның аты-жөні',
    col_email: 'Корпоративтік Email',
    col_active_tickets: 'Орындалуда',
    actions: 'Әрекеттер',
    close: 'Жабу',
    modal_staff_title: 'Қолдау маманын қосу',
    modal_staff_role: 'Жүйелік рөлі',
    modal_staff_hint: 'Маман жүйеге алғаш кірген кезде өзінің жеке құпия сөзін орната алады.',
    modal_staff_btn: 'Есептік жазбаны құру',
    collision_assigned_warning: 'Назар аударыңыз: Өтінім басқа маманға бекітілген: ',
    collision_reply_alert: 'Назар аударыңыз: Әріптесіңіз осы өтінімге жаңа ғана жауап жіберді! Жауапты жібермес бұрын төмендегі хабарламамен танысыңыз.',
    collision_confirm: 'Бұл өтінімге әріптесіңіз жауап беріп үлгерді. Клиентке тағы бір жауап жібергіңіз келетініне сенімдісіз бе?',
    auto_assigned_toast: 'Өтінім автоматты түрде сізге бекітілді'
  },
  EN: {
    // Navigation & Queues
    views: 'Queues',
    all_tickets: 'All Tickets',
    my_assigned: 'My Assigned',
    unassigned_queue: 'Unassigned Queue',
    admin_section: 'Administration',
    staff_roles: 'Staff & Roles',
    roles_departments: 'Roles & Departments',
    mailboxes_inboxes: 'Mailboxes & Inboxes',
    channels_title: 'Channels & Mailboxes',
    all_inboxes: 'All Inboxes',

    // Statuses
    status_title: 'Status',
    all_statuses: 'All Statuses',
    status_waiting: 'Waiting',
    status_in_progress: 'In Progress',
    status_resolved: 'Resolved',

    // Priorities
    priority_title: 'Priority',
    all_priorities: 'All Priorities',
    priority_critical: 'Critical',
    priority_high: 'High',
    priority_medium: 'Medium',
    priority_low: 'Low',

    // Header & Search
    tickets_heading: 'Tickets',
    search_placeholder: 'Search by subject, email, or content...',
    create_ticket: 'Create Ticket',
    online: 'Online',
    login: 'Sign In',
    logout: 'Sign Out',
    staff_and_roles: 'Staff & Roles',
    mailboxes_and_channels: 'Mailboxes & Inboxes',
    refresh: 'Refresh',

    // Ticket View Details
    empty_title: 'Select a ticket to view details',
    empty_desc: 'Select an issue from the list on the left to read history and reply to the customer',
    breadcrumb_tickets: 'Ticket Management',
    flow_title: 'Ticket Details & Conversation',
    attachments_title: 'Attachments',
    reply_from: 'Reply on behalf of:',
    reply_placeholder: 'Write a response to the customer...',
    reply_auth_locked: 'Staff authentication required to send a reply...',
    reply_auth_notice: 'Sign in as staff to reply to this ticket',
    btn_attach: 'Attach files',
    btn_download: 'Download',
    click_to_view: 'Click to view',
    expired: 'Expired',
    btn_send: 'Send Reply',
    btn_save: 'Save',
    btn_resolve: 'Resolve Ticket',
    btn_delete: 'Delete',
    btn_delete_ticket: 'Delete Ticket',
    delete: 'Delete',

    // Meta labels
    meta_sender: 'Customer / Requester',
    meta_date: 'Created Date',
    meta_status: 'Status',
    meta_priority: 'Priority',
    meta_assignee: 'Assignee',
    unassigned: '(Unassigned)',

    // Notifications
    notif_title: 'Notifications',
    notif_mark_read: 'Mark all as read',
    notif_clear: 'Clear all',
    notif_empty: 'No notifications',
    notif_new_ticket: 'New ticket',
    notif_urgent_ticket: 'Urgent ticket received',
    notif_ticket_updated: 'Ticket updated',
    notif_reply_sent: 'Reply sent',
    notif_new_reply: 'New customer reply',
    notif_changes_saved_desc: 'Changes saved',
    notif_reply_dispatched_desc: 'Reply dispatched to customer',
    notif_assigned_to_you: 'Ticket assigned to you',
    notif_no_subject: 'No subject',
    notif_customer: 'customer',


    // System Feedback
    changes_saved: 'Changes successfully saved',
    no_pending_changes: 'No pending changes to save',
    saving: 'Saving...',
    auth_required_reply: 'Please sign in with a staff account to send replies',
    back_to_list: 'Back to tickets',

    // Admin & Management
    tab_staff: 'Staff Directory',
    tab_roles: 'Roles & Departments',
    tab_mailboxes: 'Mailboxes & Inboxes',
    btn_add_role: '+ Create Role / Dept',
    btn_create_role: 'Create Role',
    create_role_title: 'Create Role / Department',
    role_name: 'Role / Department',
    role_description: 'Description',
    role_access: 'Access Level',
    role_staff_count: 'Staff Assigned',
    role_is_admin_label: 'Administrator privileges (can access Admin Control Center & settings)',
    role_name_label: 'Role / Department Name',
    role_desc_label: 'Description',
    access_admin: 'Administrator',
    access_staff: 'Support Staff',
    role_admin: 'Administrator',
    role_employee: 'Specialist',

    cancel: 'Cancel',
    role_created: 'Role created successfully',
    role_deleted: 'Role deleted successfully',
    btn_reset_pass: 'Reset Password',
    btn_reset_pass_title: 'Reset password (will prompt for a new password on next login)',
    confirm_reset_pass: 'Reset password for staff member "{name}"?\nOn their next login, they will be prompted to create a new password.',
    reset_pass_success: 'Password reset successfully. The staff member will be prompted to set a new password on next login.',
    target_role_col: 'Target Department',
    target_role_label: 'Route & Assign Tickets to Role / Department',
    target_role_hint: 'Auto-assigns incoming emails to staff in this role',
    all_departments_fallback: '(All Staff / General Queue)',

    // Auth
    auth_welcome: 'Welcome to DU HelpDesk',
    auth_subtitle: 'Enter your credentials to sign in',
    auth_login_placeholder: 'Login or email',
    auth_pass_placeholder: 'Password',
    auth_new_pass_placeholder: 'Choose a new password (min. 8 chars)...',
    auth_first_login_title: 'First-time login detected!',
    auth_first_login_desc: 'Create a password (min. 8 characters) for your account.',
    auth_first_login_btn: 'Set password & Sign in',
    auth_email_required: 'Please enter login or email',
    auth_pass_min_chars: 'Password must be at least 8 characters',
    auth_enter_password_hint: 'Enter your password to sign in',
    login_checking: 'Authenticating...',
    welcome_toast: 'Welcome back!',

    // Modals & New Tickets
    modal_new_ticket_title: 'Create Support Ticket',
    modal_customer_email: 'Customer Email',
    modal_subject: 'Subject',
    modal_subject_placeholder: 'Brief summary of request...',
    modal_priority: 'Priority',
    modal_description: 'Description / Problem Details',
    modal_description_placeholder: 'Detailed issue description...',
    modal_btn_create: 'Create & Auto-Assign',
    modal_admin_title: 'Administration Control Center',
    btn_add_staff: '+ Add Staff Member',
    btn_add_mailbox: '+ Connect Mailbox',
    col_name: 'Staff Name',
    col_email: 'Corporate Email',
    col_active_tickets: 'Active Tickets',
    actions: 'Actions',
    close: 'Close',
    modal_staff_title: 'Add Support Staff Member',
    modal_staff_role: 'System Role',
    modal_staff_hint: 'New staff members will automatically be invited to set up their password upon first sign-in.',
    modal_staff_btn: 'Create Account',
    collision_assigned_warning: 'Notice: This ticket is assigned to: ',
    collision_reply_alert: 'Notice: A colleague just replied to this ticket! Please review the new response below before replying.',
    collision_confirm: 'A colleague has already replied to this ticket. Are you sure you want to send another response to the customer?',
    auto_assigned_toast: 'Ticket automatically assigned to you'
  }
};

function initLanguage() {
  currentLang = localStorage.getItem('hd_lang') || 'RU';
  applyLanguage();
}

function applyLanguage() {
  const dict = I18N[currentLang] || I18N.RU;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (dict[k]) el.textContent = dict[k];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const k = el.getAttribute('data-i18n-placeholder');
    if (dict[k]) el.placeholder = dict[k];
  });
  const label = document.getElementById('lang-current-label');
  if (label) label.textContent = currentLang;
  const authLabel = document.getElementById('auth-lang-label');
  if (authLabel) authLabel.textContent = currentLang;

  // Dynamically update status & priority select options in Ticket Details
  const statusSelect = document.getElementById('d-status-select');
  if (statusSelect && statusSelect.options.length >= 3) {
    const cur = statusSelect.value;
    statusSelect.options[0].textContent = dict.status_waiting || 'В ожидании';
    statusSelect.options[1].textContent = dict.status_in_progress || 'В работе';
    statusSelect.options[2].textContent = dict.status_resolved || 'Решена';
    statusSelect.value = cur;
  }

  const prioritySelect = document.getElementById('d-priority-select');
  if (prioritySelect && prioritySelect.options.length >= 4) {
    const cur = prioritySelect.value;
    prioritySelect.options[0].textContent = dict.priority_low || 'Низкий';
    prioritySelect.options[1].textContent = dict.priority_medium || 'Средний';
    prioritySelect.options[2].textContent = dict.priority_high || 'Высокий';
    prioritySelect.options[3].textContent = dict.priority_critical || 'Критический';
    prioritySelect.value = cur;
  }

  const ntPriority = document.getElementById('nt-priority');
  if (ntPriority && ntPriority.options.length >= 4) {
    const cur = ntPriority.value;
    ntPriority.options[0].textContent = dict.priority_low || 'Низкий';
    ntPriority.options[1].textContent = dict.priority_medium || 'Средний';
    ntPriority.options[2].textContent = dict.priority_high || 'Высокий';
    ntPriority.options[3].textContent = dict.priority_critical || 'Критический';
    ntPriority.value = cur;
  }
}

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('hd_lang', lang);
  applyLanguage();
  updateSaveButtonState();
  renderAssigneeDropdowns();
  updateAuthUI();
  updateNotificationsUI();
  renderTicketList();
  if (typeof selectedTicketId !== 'undefined' && selectedTicketId && typeof loadTicketAttachments === 'function') {
    loadTicketAttachments(selectedTicketId);
  }
}

function toggleLanguageDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('lang-dropdown-menu');
  if (!menu) return;
  const isHidden = menu.style.display === 'none' || !menu.style.display;
  if (isHidden) {
    closeNotifications();
    closeUserDropdown();
    menu.style.display = 'flex';
  } else {
    menu.style.display = 'none';
  }
}

function toggleAuthLanguageDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('auth-lang-dropdown-menu');
  if (!menu) return;
  menu.style.display = (menu.style.display === 'none' || !menu.style.display) ? 'flex' : 'none';
}

function closeLanguageDropdown() {
  const menu = document.getElementById('lang-dropdown-menu');
  if (menu) menu.style.display = 'none';
  const authMenu = document.getElementById('auth-lang-dropdown-menu');
  if (authMenu) authMenu.style.display = 'none';
}
